/** A small async key-value store for secrets. */
export interface SecureKeyValue {
  /** False where values only live in memory (the web). */
  persistent: boolean;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
