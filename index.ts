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
import { PROGRAM_ID as GummyrollProgramId } from "@sorend-solana/gummyroll";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
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
  metadataArgsBeet,
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
    name: name,
    symbol: symbol,
    uri: "https://metaplex.com",
    creators,
    editionNonce: 0,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.Fungible,
    uses: null,
    collection: null,
    primarySaleHappened: false,
    sellerFeeBasisPoints: 0,
    isMutable: false,
  };
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
    payer,
  };
};

const transferAsset = async (
  connectionWrapper: WrappedConnection,
  newOwner: Keypair,
  assetId?: string,
  asset?: any,
  assetProof?: any
) => {
  const _assetProof = assetProof
    ? assetProof
    : await connectionWrapper.getAssetProof(assetId);

  const _asset = asset ? asset : await connectionWrapper.getAsset(assetId);

  const nonceCount = await getNonceCount(
    connectionWrapper.provider.connection,
    _assetProof.tree_id
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
      compressionProgram: GummyrollProgramId,
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
  assetId?: string,
  asset?: any,
  assetProof?: any,
  payer?: Keypair
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
      compressionProgram: GummyrollProgramId,
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
  assetId?: string,
  asset?: any,
  assetProof?: any,
  payer?: Keypair
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

  redeemAsset(connectionWrapper, leafNonce, _asset, _assetProof, payer);

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

  const metadata_deser = metadataArgsBeet.deserialize(
    bs58.decode(_asset.compression.data_hash.trim())
  )[0];

  const metadata: MetadataArgs = {
    name: metadata_deser.name,
    symbol: metadata_deser.symbol,
    uri: metadata_deser.uri,
    sellerFeeBasisPoints: metadata_deser.sellerFeeBasisPoints,
    primarySaleHappened: metadata_deser.primarySaleHappened,
    isMutable: metadata_deser.isMutable,
    editionNonce: metadata_deser.editionNonce,
    tokenStandard: metadata_deser.tokenStandard,
    collection: metadata_deser.collection,
    uses: metadata_deser.uses,
    tokenProgramVersion: metadata_deser.tokenProgramVersion,
    creators: metadata_deser.creators,
  };

  const decompressIx = createDecompressV1Instruction(
    {
      voucher: voucher,
      leafOwner: new PublicKey(_asset.ownership.owner),
      tokenAccount: await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        _asset.id,
        _asset.ownership.owner
      ),
      mint: new PublicKey(_asset.id),
      mintAuthority: mintAuthority,
      metadata: await getMetadata(_asset),
      masterEdition: await getMasterEdition(_asset),
      sysvarRent: SYSVAR_RENT_PUBKEY,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
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
  const connectionWrapper = new WrappedConnection(
    Keypair.generate(),
    connectionString,
    rpcUrl
  );

  console.log("payer", connectionWrapper.provider.wallet.publicKey.toBase58());
  await connectionWrapper.requestAirdrop(
    connectionWrapper.payer.publicKey,
    2 * LAMPORTS_PER_SOL
  );

  let originalCompressedNFT = makeCompressedNFT("test", "TST");

  let result = await setupTreeWithCompressedNFT(
    connectionWrapper,
    connectionWrapper.payer,
    originalCompressedNFT,
    14,
    64
  );
  const merkleTree = result.merkleTree;

  const leafIndex = new BN.BN(0);

  const [assetId] = await PublicKey.findProgramAddress(
    [
      Buffer.from("asset", "utf8"),
      merkleTree.toBuffer(),
      Uint8Array.from(leafIndex.toArray("le", 8)),
    ],
    BUBBLEGUM_PROGRAM_ID
  );

  const assetProof = await connectionWrapper.getAssetProof(assetId);

  const asset = await connectionWrapper.getAsset(assetId);
  const newOwner = Keypair.generate();
  console.log("new owner", newOwner.publicKey.toBase58());
  await connectionWrapper.requestAirdrop(
    newOwner.publicKey,
    2 * LAMPORTS_PER_SOL
  );

  await transferAsset(connectionWrapper, newOwner, asset, assetProof);
  await decompressAsset(connectionWrapper, asset, assetProof, newOwner);
};

wholeFlow();
