import {
  bufferToArray,
  execute,
  getVoucherPDA,
  getBubblegumAuthorityPDA,
  getNonceCount,
  getMasterEdition,
  getMetadata,
} from "./helpers";
import {
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  // LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Signer,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { WrappedConnection } from "./wrappedConnection";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import { BN } from "@project-serum/anchor";
import {
  TokenProgramVersion,
  createCreateTreeInstruction,
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  createMintV1Instruction,
  createTransferInstruction,
  createDecompressV1Instruction,
  createRedeemInstruction,
  MetadataArgs,
  Creator,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  getConcurrentMerkleTreeAccountSize,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression";

const makeCompressedNFT = (
  name: string,
  symbol: string,
  creators: Creator[] = []
) => {
  return {
    name: "Degen Ape #1338",
    symbol: "DAPE",
    uri: "https://arweave.net/gfO_TkYttQls70pTmhrdMDz9pfMUXX8hZkaoIivQjGs",
    creators: [],
    editionNonce: 253,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
    uses: null,
    collection: null,
    primarySaleHappened: false,
    sellerFeeBasisPoints: 0,
    isMutable: false,
  };
};

const sleep = async (ms: any) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const setupTreeWithCompressedNFT = async (
  connectionWrapper: WrappedConnection,
  payerKeypair: Keypair,
  compressedNFT: MetadataArgs,
  maxDepth: number = 14,
  maxBufferSize: number = 64
) => {
  const payer = payerKeypair.publicKey;
  const merkleTreeKeypair = Keypair.generate();
  const merkleTree = merkleTreeKeypair.publicKey;
  const space = getConcurrentMerkleTreeAccountSize(maxDepth, maxBufferSize);
  const allocTreeIx = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: merkleTree,
    lamports: await connectionWrapper.getMinimumBalanceForRentExemption(space),
    space: space,
    programId: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  });
  const [treeAuthority, _bump] = await PublicKey.findProgramAddress(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );
  const createTreeIx = createCreateTreeInstruction(
    {
      merkleTree,
      treeAuthority,
      treeCreator: payer,
      payer,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      maxBufferSize,
      maxDepth,
      public: false,
    },
    BUBBLEGUM_PROGRAM_ID
  );
  const mintIx = createMintV1Instruction(
    {
      merkleTree,
      treeAuthority,
      treeDelegate: payer,
      payer,
      leafDelegate: payer,
      leafOwner: payer,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
      message: compressedNFT,
    }
  );
  let tx = new Transaction().add(allocTreeIx).add(createTreeIx).add(mintIx);
  tx.feePayer = payer;
  await sendAndConfirmTransaction(
    connectionWrapper,
    tx,
    [merkleTreeKeypair, payerKeypair],
    {
      commitment: "confirmed",
      skipPreflight: true,
    }
  );
  return {
    merkleTree,
  };
};
//@ts-ignore
const transferAsset = async (
  connectionWrapper: WrappedConnection,
  newOwner: Keypair,
  asset?: any,
  assetProof?: any,
  assetId?: string
) => {
  const _assetProof = assetProof
    ? assetProof
    : await connectionWrapper.getAssetProof(assetId);
  const _asset = asset ? asset : await connectionWrapper.getAsset(assetId);

  const nonceCount = await getNonceCount(
    connectionWrapper.provider.connection,
    new PublicKey(_assetProof.tree_id)
  );

  const leafNonce = nonceCount.sub(new BN(1));
  const treeAuthority = await getBubblegumAuthorityPDA(
    new PublicKey(_assetProof.tree_id)
  );
  const leafDelegate = _asset.ownership.delegate
    ? new PublicKey(_asset.ownership.delegate)
    : new PublicKey(_asset.ownership.owner);
  let transferIx = createTransferInstruction(
    {
      treeAuthority,
      leafOwner: new PublicKey(_asset.ownership.owner),
      leafDelegate: leafDelegate,
      newLeafOwner: newOwner.publicKey,
      merkleTree: new PublicKey(_assetProof.tree_id),
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      root: bufferToArray(bs58.decode(_assetProof.root)),
      dataHash: bufferToArray(bs58.decode(_asset.compression.data_hash.trim())),
      creatorHash: bufferToArray(
        bs58.decode(_asset.compression.creator_hash.trim())
      ),
      nonce: leafNonce,
      index: 0,
    }
  );
  await execute(
    connectionWrapper.provider,
    [transferIx],
    [connectionWrapper.payer],
    true
  );
};
const redeemAsset = async (
  connectionWrapper: WrappedConnection,
  nonce = new BN(0),
  asset?: any,
  assetProof?: any,
  payer?: Keypair,
  assetId?: string
) => {
  const _assetProof = assetProof
    ? assetProof
    : await connectionWrapper.getAssetProof(assetId);
  const _asset = asset ? asset : await connectionWrapper.getAsset(assetId);
  const voucher = await getVoucherPDA(new PublicKey(_assetProof.tree_id), 0);
  const treeAuthority = await getBubblegumAuthorityPDA(
    new PublicKey(_assetProof.tree_id)
  );
  const leafDelegate = _asset.ownership.delegate
    ? new PublicKey(_asset.ownership.delegate)
    : new PublicKey(_asset.ownership.owner);
  const redeemIx = createRedeemInstruction(
    {
      treeAuthority,
      leafOwner: new PublicKey(_asset.ownership.owner),
      leafDelegate,
      merkleTree: new PublicKey(_assetProof.tree_id),
      voucher,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      root: bufferToArray(bs58.decode(_assetProof.root)),
      dataHash: bufferToArray(bs58.decode(_asset.compression.data_hash.trim())),
      creatorHash: bufferToArray(
        bs58.decode(_asset.compression.creator_hash.trim())
      ),
      nonce,
      index: 0,
    }
  );
  const _payer = payer ? payer : connectionWrapper.provider.wallet;
  await execute(
    connectionWrapper.provider,
    [redeemIx],
    [_payer as Signer],
    true
  );
};

async function decompressAsset(
  connectionWrapper: WrappedConnection,
  asset?: any,
  assetProof?: any,
  payer?: Keypair,
  assetId?: string
) {
  const _assetProof = assetProof
    ? assetProof
    : await connectionWrapper.getAssetProof(assetId);
  const _asset = asset ? asset : await connectionWrapper.getAsset(assetId);
  const voucher = await getVoucherPDA(new PublicKey(_assetProof.tree_id), 0);
  const nonceCount = await getNonceCount(
    connectionWrapper.provider.connection,
    new PublicKey(_assetProof.tree_id)
  );
  const leafNonce = nonceCount.sub(new BN(1));

  await redeemAsset(connectionWrapper, leafNonce, _asset, _assetProof, payer);

  let [assetPDA] = await PublicKey.findProgramAddress(
    [
      Buffer.from("asset"),
      new PublicKey(_assetProof.tree_id).toBuffer(),
      leafNonce.toBuffer("le", 8),
    ],
    BUBBLEGUM_PROGRAM_ID
  );
  const [mintAuthority] = await PublicKey.findProgramAddress(
    [assetPDA.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  );

  sleep(20000);
  const assetAgain = await connectionWrapper.getAsset(asset.id);

  const metadata: MetadataArgs = {
    name: _asset.content.metadata.name,
    symbol: _asset.content.metadata.symbol,
    uri: _asset.content.json_uri,
    sellerFeeBasisPoints: _asset.royalty.basis_points,
    primarySaleHappened: _asset.royalty.primary_sale_happened,
    isMutable: _asset.mutable,
    editionNonce: _asset.supply.edition_nonce,
    tokenStandard: TokenStandard.NonFungible,
    collection: _asset.grouping,
    uses: _asset.uses,
    tokenProgramVersion: TokenProgramVersion.Original,
    creators: _asset.creators,
  };

  const decompressIx = createDecompressV1Instruction(
    {
      voucher: voucher,
      leafOwner: new PublicKey(assetAgain.ownership.owner),
      tokenAccount: await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(assetAgain.id),
        new PublicKey(assetAgain.ownership.owner)
      ),
      mint: new PublicKey(assetAgain.id),
      mintAuthority: mintAuthority,
      metadata: await getMetadata(new PublicKey(assetAgain.id)),
      masterEdition: await getMasterEdition(new PublicKey(assetAgain.id)),
      sysvarRent: SYSVAR_RENT_PUBKEY,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
      // this can be grabbed onChain by using the metadataArgsBeet.deserialize
      // currently there is an error inside beet program while using it
      metadata,
    }
  );
  const _payer = payer ? payer : connectionWrapper.provider.wallet;
  await execute(
    connectionWrapper.provider,
    [decompressIx],
    [_payer as Signer],
    true
  );
}

const wholeFlow = async () => {
  const rpcUrl = "";
  const connectionString = "";
  // set up connection object
  // provides all connection functions and rpc functions
  const connectionWrapper = new WrappedConnection(
    Keypair.generate(),
    connectionString,
    rpcUrl
  );
  console.log("payer", connectionWrapper.provider.wallet.publicKey.toBase58());
  // await connectionWrapper.requestAirdrop(
  //   connectionWrapper.payer.publicKey,
  //   2 * LAMPORTS_PER_SOL
  // );
  // returns filled out metadata args struct, doesn't actually do anything mint wise
  let originalCompressedNFT = makeCompressedNFT("test", "TST");
  // creates  and executes the merkle tree ix
  // and the mint ix is executed here as well
  let result = await setupTreeWithCompressedNFT(
    connectionWrapper,
    connectionWrapper.payer,
    originalCompressedNFT,
    14,
    64
  );
  const merkleTree = result.merkleTree;
  const leafIndex = new BN.BN(0);
  // grabbing the asset id so that it can be passed to transfer
  const [assetId] = await PublicKey.findProgramAddress(
    [
      Buffer.from("asset", "utf8"),
      merkleTree.toBuffer(),
      Uint8Array.from(leafIndex.toArray("le", 8)),
    ],
    BUBBLEGUM_PROGRAM_ID
  );

  await sleep(15000);
  const assetString = assetId.toBase58();
  // const assetPreTransfer = await connectionWrapper.getAsset(assetString);
  // const assetProofPreTransfer = await connectionWrapper.getAssetProof(
  //   assetString
  // );

  const newOwner = Keypair.generate();
  console.log("new owner", newOwner.publicKey.toBase58());
  sleep(120000);
  // await connectionWrapper.requestAirdrop(
  //   newOwner.publicKey,
  //   2 * LAMPORTS_PER_SOL
  // );

  // transferring the compressed asset to a new owner
  // await transferAsset(
  //   connectionWrapper,
  //   newOwner,
  //   assetPreTransfer,
  //   assetProofPreTransfer
  // );
  // asset has to be redeemed before it can be decompressed
  // redeem is included above as a separate function because it can be called
  // without decompressing nftbut it is also called
  // inside of decompress so we don't need to call that separately here
  sleep(15000);
  // need to refetch from DB to get new owner change of ownership.owner
  const asset = await connectionWrapper.getAsset(assetString);
  const assetProof = await connectionWrapper.getAssetProof(assetString);
  await decompressAsset(
    connectionWrapper,
    asset,
    assetProof,
    connectionWrapper.payer
  );
};

wholeFlow();
