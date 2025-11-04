import { fetchComment } from "@ecp.eth/sdk/dist/esm/indexer";

export function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export type EcpAuthor = Awaited<ReturnType<typeof fetchComment>>["author"];

export function getAuthorDisplayName(author: EcpAuthor) {
  return (
    author.ens?.name ??
    author.farcaster?.username ??
    truncateAddress(author.address)
  );
}

export function getCommentAuthorUsername(author: EcpAuthor) {
  return getAuthorDisplayName(author);
}

/**
 * Formats comment content by replacing EIP155 token addresses with their tickers.
 * Similar to how the iOS app formats content in ParsedContentView.getTokenText().
 *
 * @param params - Named parameters object
 * @param params.content - The comment content string
 * @param params.references - Array of references from the comment (may include ERC20 tokens)
 * @returns Formatted content with token addresses replaced by tickers
 */
export function formatCommentContent(params: {
  content: string;
  references?: Array<{
    type?: string;
    address?: string;
    symbol?: string;
    name?: string;
  }>;
}): string {
  const { content, references = [] } = params;
  if (!content) return content;

  // EIP155 pattern: eip155:(\d+)/erc20:(0x[a-fA-F0-9]{40})
  const eip155Pattern = /eip155:(\d+)\/erc20:(0x[a-fA-F0-9]{40})/gi;

  return content.replace(eip155Pattern, (match, chainId, tokenAddress) => {
    // Find matching reference by type and address
    const matchingReference = references.find(
      (ref) =>
        ref.type === "erc20" &&
        ref.address?.toLowerCase() === tokenAddress.toLowerCase()
    );

    // Replace with ticker symbol or name, similar to iOS app logic
    if (matchingReference?.symbol) {
      return `$${matchingReference.symbol}`;
    } else if (matchingReference?.name) {
      return `$${matchingReference.name}`;
    } else {
      // Fallback to truncated address if no token info found
      return truncateAddress(tokenAddress);
    }
  });
}
