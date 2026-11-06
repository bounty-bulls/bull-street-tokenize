// Generated from contracts/out/RedemptionEngine.sol by scripts/gen-abis.ts. Do not edit.
export const redemptionEngineAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "dir_",
        "type": "address",
        "internalType": "contract Directory"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addReserve",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allocationOf",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Allocation",
        "components": [
          {
            "name": "ticketId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "pledgeId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "units",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum AllocStatus"
          },
          {
            "name": "volunteer",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "refSession",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "softSession",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "hardSession",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "cureDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "softDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "hardDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "cureEscrow",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paid",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "batchOf",
    "inputs": [
      {
        "name": "bid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RedemptionEngine.Batch",
        "components": [
          {
            "name": "assetId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "session",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "processed",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "units",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "aggTicket",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimedUnits",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimedPaid",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimBatch",
    "inputs": [
      {
        "name": "tid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimDefault",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimReserve",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "continueAllocation",
    "inputs": [
      {
        "name": "tid",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hint",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cure",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "dir",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Directory"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "domainSeparator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizeCure",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nonceUsed",
    "inputs": [
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openBatch",
    "inputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "processBatch",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "hint",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "tid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refreshWiring",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestRedemption",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hint",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "tid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reserveOf",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "free",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct RedemptionEngine.SaleReport",
        "components": [
          {
            "name": "allocationId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "grossProceeds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "saleTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "sig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sweepReserve",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ticketAllocations",
    "inputs": [
      {
        "name": "tid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ticketOf",
    "inputs": [
      {
        "name": "tid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Ticket",
        "components": [
          {
            "name": "holder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "cls",
            "type": "uint8",
            "internalType": "enum TicketClass"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum TicketStatus"
          },
          {
            "name": "openAllocs",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "requestedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "units",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remaining",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paid",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "batchId",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ticketsOf",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "wiring",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Wired.W",
        "components": [
          {
            "name": "usdc",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "treasury",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "params",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sessionClock",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "priceOracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "compliance",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "roles",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assets",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "bondVault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "brokers",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "levelBook",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "pledges",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "redemption",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "exchange",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AllocationCreated",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "pledgeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "minter",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "broker",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "level",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Level"
      },
      {
        "name": "refSession",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "cureDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "softDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "hardDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BatchClaimed",
    "inputs": [
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BatchJoined",
    "inputs": [
      {
        "name": "batchId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "session",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BatchProcessed",
    "inputs": [
      {
        "name": "batchId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "assetId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CureStarted",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "minter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "escrow",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Cured",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "toHolder",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "refund",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DefaultClaimed",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "paid",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paidUnits",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "unpaidUnits",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "NonceUsedBy",
    "inputs": [
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Requeued",
    "inputs": [
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReserveAdded",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "cash",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReservePaid",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "toHolder",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paidUnits",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Settled",
    "inputs": [
      {
        "name": "allocId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "gross",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "toHolder",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lateFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TicketCreated",
    "inputs": [
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "assetId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "cls",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum TicketClass"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TicketDone",
    "inputs": [
      {
        "name": "ticketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "paid",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WiringRefreshed",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AllocationNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BatchNotReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CureWindowClosed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CureWindowOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExposureOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LevelOrderViolated",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonceUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotDue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPledgeMinter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotWired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToAllocate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PriceNotPosted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuantityMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "TicketNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WholeSharesOnly",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
