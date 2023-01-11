## Overview

This repository contains example code for interacting with the [Metaplex Digital Asset RPC API](https://github.com/metaplex-foundation/digital-asset-rpc-infrastructure).

## Compressed NFTs and Digital Asset RPC API Background

The state data of uncompressed NFTs is all stored in on-chain accounts. This is expensive at scale. Compressed NFTs save space by encoding the state data into an on-chain Merkle tree. The detailed account data is not stored on-chain, but in data stores managed by RPC providers.

Compressed NFTs are secured on-chain by hashing their state data when it is added to the Merkle tree. The Merkle root is a hash that cryptographically secures the state data for all of the leaves (NFTs) contained in the tree.

**Bubblegum** is the Metaplex Protocol program for creating and interacting with compressed Metaplex NFTs. See the [Bubblegum README](https://github.com/metaplex-foundation/metaplex-program-library/blob/master/bubblegum/program/README.md) for more information on the Bubblegum program.

Compressed NFTs involve some extra complexity, such as sending Merkle proofs and Nonce values to Bubblegum instructions. The **Digital Asset RPC API** enables easier interaction with the Bubblegum program and the Merkle trees with which Bubblegum interacts. For example, the API can provide the Merkle proofs and Nonce information for an asset.

The Digital Asset RPC API also provides data for non-compresed NFTs, which facilitates easy handling of either compressed or non-compressed NFTs.

## To run entire flow

- Plug in values for `rpcUrl` and `connectionString` inside of `index.ts`
  For Example please use

```
https://rpc-devnet.aws.metaplex.com/
or
https://mplx-devnet.genesysgo.net/

```

You can also leave connection string blank as these above urls run both solana and metaplex RPC

## NOTE AIRDROP FAUCET CAN BECOME EMPTY

If the airdrop faucet is empty and you get

```
throw new SolanaJSONRPCError(
            ^
SolanaJSONRPCError: airdrop to 5ngQZG7aC4eZNPbYkgMc86NN2QmF918NckeLFEDXv7rp failed: Invalid request
```

If you get this then change line 342 `Keypair.generate()` to `Keypair.fromSeed("some seed")` and make sure to transfer some sol to that pubkey

- Run `ts-node ./index.ts`

#### Connection Wrapper

Inside of `wrappedConnection.ts`, there is a connection wrapper that provides both rpc endpoints as well as read api endpoints.
