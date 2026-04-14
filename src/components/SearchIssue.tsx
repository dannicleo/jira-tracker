import { useState, useRef } from "react";
import { Search, Plus, Loader2 } from "lucide-react";

interface Props {
  onAdd: (issueKey: string) => Promise<void>;
  placeholder?: string;
}

export function SearchIssue({ onAdd, placeholder = "Ex: AUT-6722" }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Valida formato de issue key: PROJ-123
  const isValidKey = /^[A-Za-z]+-\d+$/.test(value.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || !isValidKey) return;

    setLoading(true);
    setError(null);

    try {
      await onAdd(value.trim().toUpperCase());
      setValue("");
      inputRef.current?.focus();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-3 py-2">
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-400 transition-all">
          <Search size={14} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none no-drag"
            disabled={loading}
            autoFocus
          />
          <button
            type="submit"
            disabled={!isValidKey || loading}
            className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Adicionar issue"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
          </button>
        </div>
        {error && (
          <p className="mt-1.5 text-xs text-red-500 px-1 leading-snug">{error}</p>
        )}
        {value && !isValidKey && (
          <p className="mt-1 text-xs text-gray-400 px-1">
            Formato: PROJETO-123
          </p>
        )}
      </form>
    </div>
  );
}
