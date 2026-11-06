// Generated from contracts/out/LevelBook.sol by scripts/gen-abis.ts. Do not edit.
export const levelBookAbi = [
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
    "name": "cachedFree",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "free",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "level",
        "type": "uint8",
        "internalType": "enum Level"
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
    "name": "levelOf",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "level",
        "type": "uint8",
        "internalType": "enum Level"
      },
      {
        "name": "member",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "memberAt",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "level",
        "type": "uint8",
        "internalType": "enum Level"
      },
      {
        "name": "i",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "memberCount",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "level",
        "type": "uint8",
        "internalType": "enum Level"
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
    "name": "members",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "level",
        "type": "uint8",
        "internalType": "enum Level"
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
    "name": "refreshWiring",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requeueBroker",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "maxN",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "done",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "finished",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requeueCursor",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
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
    "name": "sync",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "syncMany",
    "inputs": [
      {
        "name": "ids",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "LevelChanged",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "from",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Level"
      },
      {
        "name": "to",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Level"
      },
      {
        "name": "member",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "f",
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
  }
] as const;
