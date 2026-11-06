// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Attestations, TypeHashes} from "../common/Attestations.sol";
import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {K} from "../common/Params.sol";
import {
    AllocStatus,
    Allocation,
    BrokerStatus,
    Deadlines,
    Level,
    Ticket,
    TicketClass,
    TicketStatus
} from "../common/Types.sol";
import {
    IAssetFactory,
    IBondVault,
    IBrokerRegistry,
    ILevelBook,
    IParams,
    IPledgeRegistry,
    IPriceOracle,
    ISessionClock,
    IStockToken
} from "../interfaces/IBullStreet.sol";
import "../common/Errors.sol";

/// @title RedemptionEngine
/// @notice Holders hand tokens back for USDC. Tokens are escrowed and assigned to backing through a multi-level
///         queue: L0 reserve, L1 pledges of draining/defaulted brokers, L2 volunteers, L3 at-risk, L4 normal.
///         Each assignment (allocation) is then paid one of four ways:
///           - reserve:  from reserve cash;
///           - cure:     the minter pays and keeps the shares;
///           - settle:   the broker invokes and sells the pledged shares and pays;
///           - default:  the broker missed the hard deadline, so the bond pays with a bonus.
///         Every path is priced at the close of `refSession`, the first session that opens after the request,
///         so nobody can redeem at a stale close after news breaks while NSE is closed.
///         Small requests are batched per session and paid out pro rata.
contract RedemptionEngine is Wired, Attestations, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct SaleReport {
        uint256 allocationId;
        uint256 quantity; // real shares
        uint256 grossProceeds; // USDC
        uint64 saleTime;
        uint256 nonce;
    }

    struct Batch {
        uint32 assetId;
        uint32 session;
        bool processed;
        uint256 units;
        uint256 aggTicket;
        uint256 claimedUnits;
        uint256 claimedPaid;
    }

    struct Reserve {
        uint256 units; // tokens backed by reserve cash (including those assigned to open allocations)
        uint256 free; // not yet assigned
        uint256 cash; // USDC held for the reserve
    }


    Ticket[] private _tickets;
    Allocation[] private _allocs;
    Batch[] private _batches;
    mapping(uint256 => uint256[]) private _ticketAllocs;
    mapping(address => uint256[]) private _holderTickets;
    mapping(uint32 => uint256) public openBatch;
    mapping(uint32 => Reserve) private _reserve;

    event TicketCreated(uint256 indexed ticketId, address indexed holder, uint32 indexed assetId, uint256 units, TicketClass cls);
    event BatchJoined(uint256 indexed batchId, uint256 indexed ticketId, uint256 units, uint32 session);
    event BatchProcessed(uint256 indexed batchId, uint32 indexed assetId, uint256 ticketId, uint256 units);
    event AllocationCreated(
        uint256 indexed allocId,
        uint256 indexed ticketId,
        uint256 indexed pledgeId,
        address minter,
        address broker,
        uint256 units,
        Level level,
        uint32 refSession,
        uint64 cureDeadline,
        uint64 softDeadline,
        uint64 hardDeadline
    );
    event CureStarted(uint256 indexed allocId, address indexed minter, uint256 escrow);
    event Cured(uint256 indexed allocId, address indexed payer, uint256 toHolder, uint256 fee, uint256 refund);
    event Settled(uint256 indexed allocId, uint256 gross, uint256 toHolder, uint256 fee, uint256 lateFee);
    event DefaultClaimed(uint256 indexed allocId, uint256 paid, uint256 paidUnits, uint256 unpaidUnits);
    event ReservePaid(uint256 indexed allocId, uint256 toHolder, uint256 fee, uint256 paidUnits);
    event BatchClaimed(uint256 indexed ticketId, address indexed holder, uint256 amount);
    event TicketDone(uint256 indexed ticketId, uint256 paid);
    event ReserveAdded(uint32 indexed assetId, uint256 units, uint256 cash);
    event Requeued(uint256 indexed ticketId, uint256 units);

    constructor(Directory dir_) Wired(dir_) {
        _tickets.push();
        _allocs.push();
        _batches.push();
    }

    // ================================================================== requests

    /// @notice Redeem `units` tokens (whole shares only). `hint` is an optional candidate list of pledge ids from
    ///         the off-chain planner; the contract still applies its own ordering and level rules.
    function requestRedemption(uint32 assetId, uint256 units, uint256[] calldata hint)
        external
        nonReentrant
        returns (uint256 tid)
    {
        IStockToken token = _token(assetId);
        if (units == 0) revert ZeroAmount();
        if (!token.isWholeShares(units)) revert WholeSharesOnly();
        token.transferFrom(msg.sender, address(this), units);

        tid = _tickets.length;
        Ticket storage t = _tickets.push();
        t.holder = msg.sender;
        t.assetId = assetId;
        t.units = units;
        t.remaining = units;
        t.requestedAt = uint64(block.timestamp);
        _holderTickets[msg.sender].push(tid);

        if (token.toShares(units) < _param(K.SMALL_MAX)) {
            t.cls = TicketClass.Small;
            t.status = TicketStatus.Batched;
            uint256 bid = _openBatchFor(assetId);
            _batches[bid].units += units;
            t.batchId = bid;
            emit TicketCreated(tid, msg.sender, assetId, units, TicketClass.Small);
            emit BatchJoined(bid, tid, units, _batches[bid].session);
        } else {
            t.cls = TicketClass.Standard;
            emit TicketCreated(tid, msg.sender, assetId, units, TicketClass.Standard);
            _allocate(tid, hint);
        }
    }

    /// @notice Keep allocating a ticket the dispatcher could not fully place in one transaction (or whose unpaid
    ///         part came back after a short bond).
    function continueAllocation(uint256 tid, uint256[] calldata hint) external nonReentrant {
        Ticket storage t = _ticket(tid);
        if (t.remaining == 0 || t.status == TicketStatus.Batched || t.status == TicketStatus.Done) {
            revert NothingToAllocate();
        }
        _allocate(tid, hint);
    }

    /// @notice Turn the asset's open batch of small tickets into one ticket and allocate it, once its session
    ///         has opened. Holders then claim their pro-rata share.
    function processBatch(uint32 assetId, uint256[] calldata hint) external nonReentrant returns (uint256 tid) {
        uint256 bid = openBatch[assetId];
        if (bid == 0) revert BatchNotReady();
        Batch storage b = _batches[bid];
        (uint64 openTime,) = ISessionClock(_w.sessionClock).sessionAt(b.session);
        if (block.timestamp < openTime) revert BatchNotReady();
        b.processed = true;
        openBatch[assetId] = 0;

        tid = _tickets.length;
        Ticket storage t = _tickets.push();
        t.holder = address(this);
        t.assetId = assetId;
        t.cls = TicketClass.Small;
        t.units = b.units;
        t.remaining = b.units;
        t.batchId = bid;
        t.requestedAt = uint64(block.timestamp);
        b.aggTicket = tid;
        emit BatchProcessed(bid, assetId, tid, b.units);
        _allocate(tid, hint);
    }

    function claimBatch(uint256 tid) external nonReentrant {
        Ticket storage t = _ticket(tid);
        if (t.cls != TicketClass.Small || t.holder == address(this) || t.status != TicketStatus.Batched) {
            revert WrongStatus();
        }
        Batch storage b = _batches[t.batchId];
        if (!b.processed || _tickets[b.aggTicket].status != TicketStatus.Done) revert BatchNotReady();
        uint256 pot = _tickets[b.aggTicket].paid;
        uint256 amount = b.claimedUnits + t.units == b.units ? pot - b.claimedPaid : pot * t.units / b.units;
        b.claimedUnits += t.units;
        b.claimedPaid += amount;
        t.paid = amount;
        t.remaining = 0;
        t.status = TicketStatus.Done;
        if (amount > 0) _send(t.holder, amount);
        emit BatchClaimed(tid, t.holder, amount);
        emit TicketDone(tid, amount);
    }

    // ================================================================== payouts

    /// @notice Reserve allocations pay at the reference close once it is posted.
    function claimReserve(uint256 allocId) external nonReentrant {
        Allocation storage al = _alloc(allocId);
        if (al.pledgeId != 0 || al.status != AllocStatus.Assigned) revert WrongStatus();
        Ticket storage t = _tickets[al.ticketId];
        uint256 close = _refClose(t.assetId, al.refSession);
        IStockToken token = _token(t.assetId);
        Reserve storage r = _reserve[t.assetId];

        uint256 gross = token.valueOf(al.units, close);
        uint256 payable_ = gross <= r.cash ? gross : r.cash;
        uint256 paidUnits = gross == 0 ? al.units : al.units * payable_ / gross;
        uint256 unpaid = al.units - paidUnits;
        uint256 fee = payable_ * _param(K.REDEEM_FEE_BPS) / 10_000;

        r.cash -= payable_;
        r.units -= al.units;
        if (paidUnits > 0) token.burnFrom(address(this), paidUnits);
        _payOut(t, payable_ - fee);
        if (fee > 0) _send(_w.treasury, fee);
        if (unpaid > 0) {
            IPledgeRegistry(_w.pledges).addUnbacked(t.assetId, unpaid);
            _requeue(al.ticketId, t, unpaid);
        }
        al.status = AllocStatus.ReservePaid;
        al.paid = payable_ - fee;
        emit ReservePaid(allocId, payable_ - fee, fee, paidUnits);
        _closeAlloc(al.ticketId, t);
    }

    /// @notice The minter can pay the holder instead of losing the shares, until the cure deadline. The minter
    ///         escrows last close x CURE_ESCROW_BPS now; `finalizeCure` settles at the reference close.
    function cure(uint256 allocId) external nonReentrant {
        Allocation storage al = _alloc(allocId);
        if (al.pledgeId == 0 || al.status != AllocStatus.Assigned) revert WrongStatus();
        if (block.timestamp >= al.cureDeadline) revert CureWindowClosed();
        Ticket storage t = _tickets[al.ticketId];
        (, address minter,,) = IPledgeRegistry(_w.pledges).routeInfo(al.pledgeId);
        if (msg.sender != minter) revert NotPledgeMinter();
        (uint256 lastClose,,) = IPriceOracle(_w.priceOracle).closeOf(t.assetId);
        uint256 escrow = _token(t.assetId).valueOf(al.units, lastClose) * _param(K.CURE_ESCROW_BPS) / 10_000;
        IERC20(_w.usdc).safeTransferFrom(msg.sender, address(this), escrow);
        al.cureEscrow = escrow;
        al.status = AllocStatus.CurePending;
        emit CureStarted(allocId, msg.sender, escrow);
    }

    function finalizeCure(uint256 allocId) external nonReentrant {
        Allocation storage al = _alloc(allocId);
        if (al.status != AllocStatus.CurePending) revert WrongStatus();
        Ticket storage t = _tickets[al.ticketId];
        uint256 close = _refClose(t.assetId, al.refSession);
        IPledgeRegistry reg = IPledgeRegistry(_w.pledges);
        (address broker, address minter,,) = reg.routeInfo(al.pledgeId);

        uint256 gross = _token(t.assetId).valueOf(al.units, close);
        if (gross > al.cureEscrow) gross = al.cureEscrow;
        uint256 fee = gross * _param(K.REDEEM_FEE_BPS) / 10_000;
        uint256 refund = al.cureEscrow - gross;

        _token(t.assetId).burnFrom(address(this), al.units);
        reg.onCure(al.pledgeId, al.units);
        _payOut(t, gross - fee);
        _splitFee(fee, broker, address(0), 0);
        if (refund > 0) _send(minter, refund);
        al.status = AllocStatus.Cured;
        al.paid = gross - fee;
        emit Cured(allocId, minter, gross - fee, fee, refund);
        _closeAlloc(al.ticketId, t);
    }

    /// @notice The broker invoked and sold the shares. Pays max(sale, FLOOR x reference close) from its wallet
    ///         (pre-approved), plus a late fee from the bond after the soft deadline.
    function settle(SaleReport calldata r, bytes calldata sig) external nonReentrant {
        Allocation storage al = _alloc(r.allocationId);
        if (al.pledgeId == 0 || al.status != AllocStatus.Assigned) revert WrongStatus();
        if (block.timestamp < al.cureDeadline) revert CureWindowOpen();
        Ticket storage t = _tickets[al.ticketId];
        IStockToken token = _token(t.assetId);
        if (r.quantity != token.toShares(al.units)) revert QuantityMismatch();
        uint256 close = _refClose(t.assetId, al.refSession);
        (address broker, address minter,,) = IPledgeRegistry(_w.pledges).routeInfo(al.pledgeId);
        {
            bytes32 structHash = keccak256(
                abi.encode(
                    TypeHashes.SALE_REPORT, r.allocationId, r.quantity, r.grossProceeds, r.saleTime, r.nonce
                )
            );
            address signer =
                _verifyEither(broker, IBrokerRegistry(_w.brokers).delegateOf(broker), structHash, sig);
            _useNonce(signer, r.nonce);
        }

        uint256 floorValue = token.valueOf(al.units, close) * _param(K.FLOOR_BPS) / 10_000;
        uint256 gross = r.grossProceeds > floorValue ? r.grossProceeds : floorValue;
        IERC20(_w.usdc).safeTransferFrom(broker, address(this), gross);
        uint256 fee = gross * _param(K.REDEEM_FEE_BPS) / 10_000;
        uint256 rebate = al.volunteer ? gross * _param(K.VOLUNTEER_REBATE_BPS) / 10_000 : 0;
        uint256 lateFee = _payLateFee(al, t, broker, token.valueOf(al.units, close));

        token.burnFrom(address(this), al.units);
        IPledgeRegistry(_w.pledges).onSettle(al.pledgeId, al.units);
        _payOut(t, gross - fee);
        _splitFee(fee, broker, minter, rebate);
        al.status = AllocStatus.Settled;
        al.paid = gross - fee + lateFee;
        emit Settled(r.allocationId, gross, gross - fee, fee, lateFee);
        _closeAlloc(al.ticketId, t);
    }

    /// @notice After the hard deadline (or as soon as the reference close is posted if the broker is already
    ///         Defaulted), the bond pays close x (1 + DEFAULT_BONUS) plus late fees. Only the covered part burns;
    ///         the rest goes back into the queue.
    function claimDefault(uint256 allocId) external nonReentrant {
        Allocation storage al = _alloc(allocId);
        if (al.pledgeId == 0 || al.status != AllocStatus.Assigned) revert WrongStatus();
        Ticket storage t = _tickets[al.ticketId];
        IPledgeRegistry reg = IPledgeRegistry(_w.pledges);
        (address broker,,,) = reg.routeInfo(al.pledgeId);
        IBrokerRegistry brokers = IBrokerRegistry(_w.brokers);

        uint256 price;
        if (brokers.statusOf(broker) == BrokerStatus.Defaulted) {
            price = _refClose(t.assetId, al.refSession);
        } else {
            if (block.timestamp < al.hardDeadline) revert NotDue();
            price = _refClose(t.assetId, al.hardSession);
        }
        IStockToken token = _token(t.assetId);
        uint256 value = token.valueOf(al.units, price);
        uint256 due = value * (10_000 + _param(K.DEFAULT_BONUS_BPS)) / 10_000 + _lateFeeDue(al, value);
        address dest = t.holder == address(this) ? address(this) : t.holder;
        uint256 paid = IBondVault(_w.bondVault).payFromBond(broker, dest, due, "DEFAULT");
        uint256 paidUnits = paid >= due ? al.units : al.units * paid / due;
        uint256 unpaid = al.units - paidUnits;

        if (paidUnits > 0) token.burnFrom(address(this), paidUnits);
        reg.onDefault(al.pledgeId, paidUnits, unpaid);
        brokers.markDefaulted(broker);
        t.paid += paid;
        al.status = AllocStatus.Defaulted;
        al.paid = paid;
        if (unpaid > 0) {
            if (IBondVault(_w.bondVault).bondOf(broker) == 0) reg.writeOffInsolvent(al.pledgeId);
            _requeue(al.ticketId, t, unpaid);
        }
        emit DefaultClaimed(allocId, paid, paidUnits, unpaid);
        _closeAlloc(al.ticketId, t);
    }

    // ================================================================== reserve

    function addReserve(uint32 assetId, uint256 units, uint256 cash) external {
        if (msg.sender != _w.pledges) revert NotWired();
        Reserve storage r = _reserve[assetId];
        r.units += units;
        r.free += units;
        r.cash += cash;
        emit ReserveAdded(assetId, units, cash);
    }

    /// @notice Cash left over once every reserve-backed token is gone goes to the treasury (permissionless).
    function sweepReserve(uint32 assetId) external nonReentrant {
        Reserve storage r = _reserve[assetId];
        if (r.units != 0) revert ExposureOpen();
        uint256 cash = r.cash;
        r.cash = 0;
        if (cash > 0) _send(_w.treasury, cash);
    }

    // ================================================================== views

    function ticketOf(uint256 tid) external view returns (Ticket memory) {
        return _tickets[tid];
    }

    function allocationOf(uint256 allocId) external view returns (Allocation memory) {
        return _allocs[allocId];
    }

    function ticketAllocations(uint256 tid) external view returns (uint256[] memory) {
        return _ticketAllocs[tid];
    }

    function ticketsOf(address holder) external view returns (uint256[] memory) {
        return _holderTickets[holder];
    }



    function batchOf(uint256 bid) external view returns (Batch memory) {
        return _batches[bid];
    }


    function reserveOf(uint32 assetId) external view returns (uint256 units, uint256 free, uint256 cash) {
        Reserve memory r = _reserve[assetId];
        return (r.units, r.free, r.cash);
    }


    // ================================================================== dispatcher

    struct Ctx {
        uint32 assetId;
        uint256 need;
        uint256 steps;
        uint256 maxAllocs;
        uint256 maxScan;
        uint256 pledgeAllocs;
        Deadlines d;
        address[] used;
        uint256 usedLen;
    }

    function _allocate(uint256 tid, uint256[] calldata hint) private {
        Ticket storage t = _tickets[tid];
        Ctx memory c;
        c.assetId = t.assetId;
        c.need = t.remaining;
        c.maxAllocs = _param(K.MAX_ALLOCS);
        c.maxScan = _param(K.MAX_SCAN);
        c.d = ISessionClock(_w.sessionClock).deadlines(uint64(block.timestamp));
        c.used = new address[](c.maxAllocs);

        // L0: reserve
        Reserve storage r = _reserve[c.assetId];
        if (r.free > 0 && c.need > 0) {
            uint256 x = c.need < r.free ? c.need : r.free;
            r.free -= x;
            _newAlloc(tid, 0, x, false, Level.Reserve, address(0), address(0), c.d);
            c.need -= x;
            ++c.steps;
        }

        ILevelBook book = ILevelBook(_w.levelBook);
        IPledgeRegistry reg = IPledgeRegistry(_w.pledges);
        for (uint8 lv = uint8(Level.Drain); lv <= uint8(Level.Normal) && c.need > 0; ++lv) {
            Level level = Level(lv);
            while (c.need > 0 && c.steps < c.maxAllocs && book.free(c.assetId, level) > 0) {
                (uint256 pid, address broker, address minter, uint256 f) = _pick(c, level, hint);
                if (pid == 0) {
                    if (hint.length > 0) revert LevelOrderViolated();
                    break;
                }
                if (
                    IBrokerRegistry(_w.brokers).statusOf(broker) == BrokerStatus.Defaulted
                        && IBondVault(_w.bondVault).bondOf(broker) == 0
                ) {
                    reg.writeOffInsolvent(pid);
                    continue;
                }
                uint256 x = c.need < f ? c.need : f;
                reg.onAllocate(pid, x);
                _newAlloc(tid, pid, x, level == Level.Volunteer, level, minter, broker, c.d);
                c.used[c.usedLen++] = broker;
                c.need -= x;
                ++c.steps;
                ++c.pledgeAllocs;
            }
            // Level order: never serve from a lower level while a higher one still has free backing.
            if (c.need > 0 && book.free(c.assetId, level) > 0) break;
        }

        t.remaining = c.need;
        if (c.pledgeAllocs > 1) t.cls = TicketClass.Large;
        t.status = c.need == 0 ? TicketStatus.Allocated : TicketStatus.PartiallyAllocated;
        if (t.openAllocs == 0 && t.remaining == 0) _done(tid, t);
    }

    /// @dev Best fit (smallest f >= need, else largest f), preferring brokers not yet used by this ticket, then
    ///      the minter whose shares were invoked longest ago, then the lowest pledge id.
    function _pick(Ctx memory c, Level level, uint256[] calldata hint)
        private
        view
        returns (uint256 pid, address broker, address minter, uint256 f)
    {
        (pid, broker, minter, f) = _scan(c, level, hint, true);
        if (pid == 0) (pid, broker, minter, f) = _scan(c, level, hint, false);
    }

    function _scan(Ctx memory c, Level level, uint256[] calldata hint, bool freshOnly)
        private
        view
        returns (uint256 best, address bBroker, address bMinter, uint256 bF)
    {
        ILevelBook book = ILevelBook(_w.levelBook);
        IPledgeRegistry reg = IPledgeRegistry(_w.pledges);
        uint256 n = hint.length > 0 ? hint.length : book.memberCount(c.assetId, level);
        if (hint.length == 0 && n > c.maxScan) n = c.maxScan;
        uint64 bLru;
        for (uint256 i; i < n; ++i) {
            uint256 id;
            if (hint.length > 0) {
                id = hint[i];
                (Level hl, bool member) = book.levelOf(id);
                if (!member || hl != level) continue;
            } else {
                id = book.memberAt(c.assetId, level, i);
            }
            (address broker, address minter, uint256 f, uint32 asset) = reg.routeInfo(id);
            if (f == 0 || asset != c.assetId) continue;
            if (freshOnly && _used(c, broker)) continue;
            uint64 lru = reg.lastInvokedAt(minter);
            if (best == 0 || _better(f, lru, id, bF, bLru, best, c.need)) {
                (best, bBroker, bMinter, bF, bLru) = (id, broker, minter, f, lru);
            }
        }
    }

    function _better(uint256 f, uint64 lru, uint256 id, uint256 bF, uint64 bLru, uint256 bId, uint256 need)
        private
        pure
        returns (bool)
    {
        bool fits = f >= need;
        bool bFits = bF >= need;
        if (fits != bFits) return fits;
        if (f != bF) return fits ? f < bF : f > bF;
        if (lru != bLru) return lru < bLru;
        return id < bId;
    }

    function _used(Ctx memory c, address broker) private pure returns (bool) {
        for (uint256 i; i < c.usedLen; ++i) {
            if (c.used[i] == broker) return true;
        }
        return false;
    }

    function _newAlloc(
        uint256 tid,
        uint256 pid,
        uint256 units,
        bool volunteer,
        Level level,
        address minter,
        address broker,
        Deadlines memory d
    ) private {
        uint256 id = _allocs.length;
        _allocs.push(
            Allocation({
                ticketId: tid,
                pledgeId: pid,
                units: units,
                status: AllocStatus.Assigned,
                volunteer: volunteer,
                refSession: d.refSession,
                softSession: d.softSession,
                hardSession: d.hardSession,
                cureDeadline: d.cure,
                softDeadline: d.soft,
                hardDeadline: d.hard,
                cureEscrow: 0,
                paid: 0
            })
        );
        _ticketAllocs[tid].push(id);
        ++_tickets[tid].openAllocs;
        emit AllocationCreated(id, tid, pid, minter, broker, units, level, d.refSession, d.cure, d.soft, d.hard);
    }

    // ================================================================== internal helpers

    function _requeue(uint256 tid, Ticket storage t, uint256 units) private {
        t.remaining += units;
        t.status = TicketStatus.PartiallyAllocated;
        emit Requeued(tid, units);
    }

    function _closeAlloc(uint256 tid, Ticket storage t) private {
        --t.openAllocs;
        if (t.openAllocs == 0 && t.remaining == 0) _done(tid, t);
    }

    function _done(uint256 tid, Ticket storage t) private {
        t.status = TicketStatus.Done;
        emit TicketDone(tid, t.paid);
    }

    /// @dev Pays the holder, or adds to the batch pot when the ticket is a batch aggregate.
    function _payOut(Ticket storage t, uint256 amount) private {
        t.paid += amount;
        if (t.holder != address(this) && amount > 0) _send(t.holder, amount);
    }

    function _splitFee(uint256 fee, address broker, address minter, uint256 rebate) private {
        if (fee == 0) return;
        uint256 brokerShare = fee * _param(K.BROKER_FEE_SHARE_BPS) / 10_000;
        uint256 rest = fee - brokerShare;
        if (rebate > rest) rebate = rest;
        if (brokerShare > 0) _send(broker, brokerShare);
        if (rebate > 0) _send(minter, rebate);
        if (rest > rebate) _send(_w.treasury, rest - rebate);
    }

    function _send(address to, uint256 amount) private {
        IERC20(_w.usdc).safeTransfer(to, amount);
    }

    function _lateFeeDue(Allocation storage al, uint256 value) private view returns (uint256) {
        (bool found, uint32 last) = ISessionClock(_w.sessionClock).lastClosedSession();
        if (!found || last <= al.softSession) return 0;
        return value * _param(K.LATE_FEE_BPS) * (last - al.softSession) / 10_000;
    }

    function _payLateFee(Allocation storage al, Ticket storage t, address broker, uint256 value)
        private
        returns (uint256 paid)
    {
        uint256 due = _lateFeeDue(al, value);
        if (due == 0) return 0;
        address dest = t.holder == address(this) ? address(this) : t.holder;
        paid = IBondVault(_w.bondVault).payFromBond(broker, dest, due, "LATE_FEE");
        t.paid += paid;
    }

    function _refClose(uint32 assetId, uint32 session) private view returns (uint256 close) {
        close = IPriceOracle(_w.priceOracle).closeAt(assetId, session);
        if (close == 0) revert PriceNotPosted();
    }

    function _openBatchFor(uint32 assetId) private returns (uint256 bid) {
        bid = openBatch[assetId];
        if (bid != 0) return bid;
        bid = _batches.length;
        Batch storage b = _batches.push();
        b.assetId = assetId;
        b.session = ISessionClock(_w.sessionClock).nextSessionIndex();
        openBatch[assetId] = bid;
    }

    function _ticket(uint256 tid) private view returns (Ticket storage) {
        if (tid == 0 || tid >= _tickets.length) revert TicketNotFound();
        return _tickets[tid];
    }

    function _alloc(uint256 id) private view returns (Allocation storage) {
        if (id == 0 || id >= _allocs.length) revert AllocationNotFound();
        return _allocs[id];
    }

    function _token(uint32 assetId) private view returns (IStockToken) {
        return IStockToken(IAssetFactory(_w.assets).tokenOf(assetId));
    }

    function _param(bytes32 key) private view returns (uint256) {
        return IParams(_w.params).get(key);
    }
}
