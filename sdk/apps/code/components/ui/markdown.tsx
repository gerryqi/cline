import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MemoizedMarkdownBlock = memo(
	({ content }: { content: string }) => {
		return (
			<div className="markdown">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
			</div>
		);
	},
	(prevProps, nextProps) => {
		if (prevProps.content !== nextProps.content) return false;
		return true;
	},
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export function parseMarkdownIntoBlocks(markdown: string): string[] {
	const tokens = marked.lexer(markdown);
	return tokens.map((token) => token.raw);
}

export const MemoizedMarkdown = memo(
	({ content, id }: { content: string; id: string }) => {
		const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

		return blocks.map((block, index) => (
			<MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
		));
	},
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
