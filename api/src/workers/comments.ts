import { Worker } from "bullmq";
import {
  COMMENTS_QUEUE_NAME,
  NOTIFICATIONS_QUEUE_NAME,
} from "../lib/constants";
import { cacheUserData, fetchCachedComment } from "../lib/ecp";
import { sanitizeNotificationData } from "../lib/notifications";
import { notificationsQueue } from "../lib/queue";
import { redisQueue } from "../lib/redis";
import { formatCommentContent, getCommentAuthorUsername } from "../lib/utils";
import { CommentJobData } from "../types/jobs";

export const commentWorker = new Worker<CommentJobData>(
  COMMENTS_QUEUE_NAME,
  async (job) => {
    const { commentId, content, parentId, commentType, chainId } = job.data;
    // TODO: Implement comment processing
    console.log(`Processing comment ${commentId}`);

    // Fetch the comment from the ECP hosted API
    const comment = await fetchCachedComment({
      chainId: job.data.chainId,
      commentId: commentId as `0x${string}`,
      options: {
        maxAttempts: 5,
        initialDelayMs: 1000,
      },
    });

    const authorUsername = getCommentAuthorUsername(comment.author);
    let parentAuthorAddress: string | undefined;
    // Cache actor's profile
    await cacheUserData({
      author: comment.author.address as `0x${string}`,
      profile: comment.author,
    });

    if (comment.parentId) {
      // Fetch parent comment
      const parentComment = await fetchCachedComment({
        chainId: job.data.chainId,
        commentId: parentId as `0x${string}`,
        options: {
          maxAttempts: 5,
          initialDelayMs: 1000,
        },
      });

      if (commentType === 1) {
        // Notify parent author if reaction
        // Cache parent author's profile
        await cacheUserData({
          author: parentComment.author.address as `0x${string}`,
          profile: parentComment.author,
        });
        parentAuthorAddress = parentComment.author.address;
        await notificationsQueue.add(NOTIFICATIONS_QUEUE_NAME, {
          author: parentComment.author.address,
          notification: sanitizeNotificationData({
            title: `${
              comment.content === "like" ? "liked" : "reaction"
            } by @${authorUsername} `,
            body: formatCommentContent({
              content: parentComment.content,
              references: parentComment.references || [],
            }),
            data: {
              type: comment.content === "like" ? "reaction" : "reaction",
              reactionType:
                comment.content === "like" ? "like" : comment.content,
              commentId: comment.id,
              parentId: parentComment.id,
              chainId,
              actorAddress: comment.author.address,
              parentAddress: parentComment.author.address,
            },
          }),
        });
      } else {
        console.log("Notifying parent if reply", parentComment.author.address);
        // Notify parent if reply
        // Cache parent author's profile
        await cacheUserData({
          author: parentComment.author.address as `0x${string}`,
          profile: parentComment.author,
        });
        parentAuthorAddress = parentComment.author.address;
        await notificationsQueue.add(NOTIFICATIONS_QUEUE_NAME, {
          author: parentComment.author.address,
          notification: sanitizeNotificationData({
            title: `reply from @${authorUsername}`,
            body: formatCommentContent({
              content: comment.content,
              references: comment.references || [],
            }),
            data: {
              type: "reply",
              commentId: comment.id,
              parentId: parentComment.id,
              chainId,
              actorAddress: comment.author.address,
              parentAddress: parentComment.author.address,
            },
          }),
        });
      }
    }

    // Notify mentioned users
    const mentionedAddresses = comment.references
      .map((reference) => {
        if (reference.type === "ens") {
          return reference.address.toLowerCase();
        } else if (reference.type === "farcaster") {
          return reference.address.toLowerCase();
        }
      })
      .filter((address) => address !== undefined) as string[];

    const uniqueMentionedAddresses = Array.from(new Set(mentionedAddresses));

    for (const address of uniqueMentionedAddresses) {
      await notificationsQueue.add(NOTIFICATIONS_QUEUE_NAME, {
        author: address,
        notification: sanitizeNotificationData({
          title: `@${authorUsername} mentioned you`,
          body: formatCommentContent({
            content: comment.content,
            references: comment.references || [],
          }),
          data: {
            type: "mention",
            commentId: comment.id,
            parentId: parentId ?? null,
            chainId,
            actorAddress: comment.author.address,
            parentAddress: parentAuthorAddress,
          },
        }),
      });
    }

    // Only send notifications for top level posts
    if (
      !comment.parentId ||
      comment.parentId ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      // Notify subscribers to this author's posts (followers)
      try {
        const lowerAuthor = comment.author.address.toLowerCase();
        // Find app userIds who subscribed to this author and have at least one device registered
        // Join post_subscriptions -> users.notifications exists
        // Prisma: find users where postSubscriptions.some({ targetAuthor: lowerAuthor }) and notifications.some({})
        const subs = await (
          await import("../lib/prisma")
        ).prisma.user.findMany({
          where: {
            postSubscriptions: { some: { targetAuthor: lowerAuthor } },
            notifications: { some: {} },
          },
          select: { id: true },
        });

        const uniqueUserIds = Array.from(new Set(subs.map((u) => u.id)));
        if (uniqueUserIds.length > 0) {
          await notificationsQueue.add(NOTIFICATIONS_QUEUE_NAME, {
            author: comment.author.address,
            targetUserIds: uniqueUserIds,
            notification: sanitizeNotificationData({
              title: `@${authorUsername} posted`,
              body: formatCommentContent({
                content: comment.content,
                references: comment.references || [],
              }),
              data: {
                type: "post",
                commentId: comment.id,
                parentId: parentId ?? null,
                chainId,
                actorAddress: comment.author.address,
              },
            }),
          });
        }
      } catch (e) {
        console.error("Failed to enqueue subscriber notifications", e);
      }
    }
  },
  {
    connection: redisQueue,
  }
);
