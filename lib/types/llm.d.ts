/**
 * dsh-cubox — LLM prompt processing.
 *
 * A minimal OpenAI-compatible chat-completions client (DeepSeek-style). The
 * base URL, API key, and model are configured in the settings panel (the AI
 * section of this plugin). Used to run today's collection through a
 * user-editable prompt before writing the daily brief to the output dir.
 */
/** LLM endpoint configuration. */
export interface LlmConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}
/** Is the LLM configured (key + base url + model present)? */
export declare function llmConfigured(config: LlmConfig): boolean;
/**
 * One chat completion. Resolves the assistant text; rejects with a readable
 * error on transport or API failures.
 */
export declare function chatComplete(config: LlmConfig, system: string, user: string): Promise<string>;
