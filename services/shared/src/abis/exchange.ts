// Generated from contracts/out/BullStreetExchange.sol by scripts/gen-abis.ts. Do not edit.
export const exchangeAbi = [
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
    "name": "assetOrderCount",
    "inputs": [
      {
        "name": "assetId",
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
    "name": "cancel",
    "inputs": [
      {
        "name": "id",
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
    "name": "getOrder",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct BullStreetExchange.Order",
        "components": [
          {
            "name": "maker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "side",
            "type": "uint8",
            "internalType": "enum BullStreetExchange.Side"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum BullStreetExchange.OrderStatus"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "price",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remaining",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "usdcEscrow",
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
    "name": "lastTradePrice",
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
    "name": "openOrders",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "enum BullStreetExchange.Side"
      },
      {
        "name": "offset",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "ids",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "orders",
        "type": "tuple[]",
        "internalType": "struct BullStreetExchange.Order[]",
        "components": [
          {
            "name": "maker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "side",
            "type": "uint8",
            "internalType": "enum BullStreetExchange.Side"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum BullStreetExchange.OrderStatus"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "price",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remaining",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "usdcEscrow",
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
    "name": "orderCount",
    "inputs": [],
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
    "name": "ordersOf",
    "inputs": [
      {
        "name": "maker",
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
    "name": "reclaim",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
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
    "name": "trade",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct BullStreetExchange.TradeParams",
        "components": [
          {
            "name": "assetId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "side",
            "type": "uint8",
            "internalType": "enum BullStreetExchange.Side"
          },
          {
            "name": "limitPrice",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "fillIds",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "rest",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "minFilled",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "filled",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "restingId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "usdcFor",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "price",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundUp",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
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
    "name": "OrderClosed",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BullStreetExchange.OrderStatus"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderFilled",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "maker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "taker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "assetId",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BullStreetExchange.Side"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "usdc",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderPlaced",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "maker",
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
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BullStreetExchange.Side"
      },
      {
        "name": "price",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
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
    "name": "BadExpiry",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BelowMinFill",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotMaker",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotYetExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OrderNotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OrderTooSmall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Paused",
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
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
