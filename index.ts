import { makeCompressedNFT } from "./helpers";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createTree, createNFT, transferAsset } from "./lib";

const compression = async () => {
  // payer keypair
  const payer = Keypair.fromSeed(
    new TextEncoder().encode("hello world".padEnd(32, "\0"))
  );


  // setting up the NFT metadata
  let metadata = makeCompressedNFT(
    "Degen Ape #1338",
    "DAA",
    "https://arweave.net/gfO_TkYttQls70pTmhrdMDz9pfMUXX8hZkaoIivQjGs"
  );


  // Create a new Merkle tree
  const merkleTree = await createTree(payer);
  console.log("New Merkle tree created:", merkleTree.toString());


  /* Mint a new NFT in the created merkle tree
  For each NFT, a new mint address is created, alternatively you can pass a mint address
  to create NFT in a particular collection */
  const mintAddress = await createNFT(payer, metadata, merkleTree);
  console.log("New NFT created:", mintAddress.toString());

  
  // Transfer created NFT to a new owner
  const destination = new PublicKey(
    "HNc6qPhyi5zgEZbM1wfHafghAGpMqDPZWeuxNmC61XU6"
  );
  const signature = await transferAsset(payer, destination, merkleTree);
  console.log("NFT transferred, TX signature:", signature);
};

compression();
