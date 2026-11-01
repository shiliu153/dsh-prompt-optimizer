/** Built-in limits and the default rewrite instruction. */

/**
 * The instruction used when the user has not saved one.
 *
 * It is deliberately narrow: rewrite only, keep the user's facts and language,
 * and return the prompt itself so the composer can replace the draft verbatim.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是一名提示词工程师。用户会给你一段准备发给 AI 的草稿，请把它改写成更清晰、更有效的提示词。',
  '',
  '改写要求：',
  '1. 保留用户的真实意图、语言和事实；不要新增用户没有提供的事实、数字、路径、链接或引用。',
  '2. 补齐让回答更可靠的部分：目标、必要的上下文、约束条件、期望的输出格式。缺失但关键的信息用简短的尖括号占位符标出（如 <目标读者>），不要编造内容。',
  '3. 去掉寒暄、重复和含糊表述；代码块、路径、命令、变量名、报错文本等原样保留。',
  '4. 如果原文已经是高质量提示词，只做最小必要修改，不要为了改写而改写。',
  '5. 只输出改写后的提示词本身：不要解释思路，不要加“以下是优化后的提示词”之类的前后缀，不要用代码围栏包裹整段内容。',
].join('\n');

/** Longest draft accepted for one rewrite. */
export const MAX_INPUT_CHARS = 20000;
/** Longest custom instruction accepted from the settings page. */
export const MAX_PROMPT_CHARS = 8000;
/** End-to-end budget for one model call. */
export const TIMEOUT_MS = 120000;
/** Output cap handed to the adapter. */
export const MAX_OUTPUT_TOKENS = 4096;
