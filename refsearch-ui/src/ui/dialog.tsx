import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

export function Confirm({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  requireText,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  requireText?: string; // e.g., "NUKE"
  onConfirm: () => void;
}) {
  const [text, setText] = useState("");
  const canConfirm = requireText ? text === requireText : true;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.2)" }}
        />
        <Dialog.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            background: "#fff",
            padding: 16,
            borderRadius: 8,
            width: 360,
          }}
        >
          <Dialog.Title style={{ fontWeight: 600 }}>{title}</Dialog.Title>
          <div style={{ fontSize: 14, marginBottom: 12 }}>{message}</div>
          {requireText && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                Type <b>{requireText}</b> to confirm
              </div>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #ccc",
                  borderRadius: 6,
                }}
              />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Dialog.Close asChild>
              <button
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                }}
              >
                {" "}
                {cancelLabel}{" "}
              </button>
            </Dialog.Close>
            <button
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              disabled={!canConfirm}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #e00",
                color: "#e00",
                background: "white",
                opacity: canConfirm ? 1 : 0.5,
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
