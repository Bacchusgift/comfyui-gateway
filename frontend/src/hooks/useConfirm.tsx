import { useState, useCallback } from "react";
import ConfirmDialog, { type ConfirmVariant } from "../components/ConfirmDialog";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
  resolver: ((value: boolean) => void) | null;
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    title: "",
    message: "",
    resolver: null,
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        ...options,
        isOpen: true,
        resolver: resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolver?.(true);
    setState((prev) => ({ ...prev, isOpen: false, resolver: null }));
  }, [state.resolver]);

  const handleClose = useCallback(() => {
    state.resolver?.(false);
    setState((prev) => ({ ...prev, isOpen: false, resolver: null }));
  }, [state.resolver]);

  const dialog = (
    <ConfirmDialog
      isOpen={state.isOpen}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={state.title}
      message={state.message}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      variant={state.variant}
    />
  );

  return { confirm, dialog };
}
