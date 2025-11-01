import { COMMENT_MANAGER_ADDRESS, CommentManagerABI } from "@ecp.eth/sdk";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { commentsQueue } from "./lib/queue";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

const unwatch = publicClient.watchContractEvent({
  address: COMMENT_MANAGER_ADDRESS,
  abi: CommentManagerABI,
  onLogs: async (logs) => {
    if (!logs.length) return;
    console.log(
      `Received ${logs.length} CommentAdded log(s). First tx: ${logs[0].transactionHash}`
    );

    await Promise.all(
      logs.map(async (log) => {
        if (log.eventName !== "CommentAdded") return;

        if (!log.args.commentId) return;
        await commentsQueue.add(
          "processComment",
          {
            commentId: log.args.commentId,
            chainId: base.id,
            content: log.args.content,
            parentId: log.args.parentId,
            commentType: log.args.commentType,
          },
          {
            jobId: log.args.commentId,
          }
        );
      })
    );
  },
  onError: (error) => {
    console.error("watchContractEvent error:", error);
  },
  pollingInterval: 10_000,
  poll: true,
});

process.on("exit", () => {
  unwatch();
});

console.log(
  `Listening for CommentAdded events on ${base.name} at address ${COMMENT_MANAGER_ADDRESS}`
);
