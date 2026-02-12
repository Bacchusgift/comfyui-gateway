import { useState, useCallback } from "react";
import PromptDialog from "../components/PromptDialog";

interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  validator?: (value: string) => string | null;
}

interface PromptState extends PromptOptions {
  isOpen: boolean;
  resolver: ((value: string | null) => void) | null;
}

export function usePrompt() {
  const [state, setState] = useState<PromptState>({
    isOpen: false,
    message: "",
    resolver: null,
  });

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({
        ...options,
        isOpen: true,
        resolver: resolve,
      });
    });
  }, []);

  const handleSubmit = useCallback((value: string) => {
    state.resolver?.(value);
    setState((prev) => ({ ...prev, isOpen: false, resolver: null }));
  }, [state.resolver]);

  const handleClose = useCallback(() => {
    state.resolver?.(null);
    setState((prev) => ({ ...prev, isOpen: false, resolver: null }));
  }, [state.resolver]);

  const dialog = (
    <PromptDialog
      isOpen={state.isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={state.title}
      message={state.message}
      placeholder={state.placeholder}
      defaultValue={state.defaultValue}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      validator={state.validator}
    />
  );

  return { prompt, dialog };
}
