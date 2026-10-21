import { Modal } from "@heroui/react/modal";
import { X } from "./icons";
import { cloneElement, createContext, isValidElement, useContext, useId, type ReactElement, type ReactNode } from "react";

import { cn } from "./cn";

type DialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

const ControlledDialogContext = createContext<Pick<DialogProps, "open" | "onOpenChange"> | null>(null);

export function Dialog({ open, defaultOpen, onOpenChange, children }: DialogProps) {
  if (open !== undefined) {
    return <ControlledDialogContext.Provider value={{ open, onOpenChange }}>{children}</ControlledDialogContext.Provider>;
  }
  return <Modal isOpen={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>{children}</Modal>;
}

// Modal uses its direct button child as the trigger. Keep the existing call sites intact.
export function DialogTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
  return <>{children}</>;
}

export function DialogClose({ children }: { asChild?: boolean; children: ReactElement<{ slot?: string }> }) {
  return isValidElement(children) ? cloneElement(children, { slot: "close" }) : null;
}

export function DialogContent({
  title,
  description,
  className,
  children,
  hideCloseButton = false,
}: {
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
  hideCloseButton?: boolean;
}) {
  const controlled = useContext(ControlledDialogContext);
  const descriptionId = useId();

  return (
    <Modal.Backdrop className="orbis-modal-backdrop" isOpen={controlled?.open} onOpenChange={controlled?.onOpenChange}>
      <Modal.Container className="orbis-modal-container">
        <Modal.Dialog
          aria-describedby={description ? descriptionId : undefined}
          className={cn("orbis-modal-dialog", className)}
        >
          <Modal.Header className="orbis-modal-header">
            <div>
              <Modal.Heading className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                {title}
              </Modal.Heading>
              {description ? <p id={descriptionId} className="text-sm leading-6 text-[var(--text-secondary)]">{description}</p> : null}
            </div>
            {hideCloseButton ? null : (
              <Modal.CloseTrigger aria-label="关闭" className="orbis-modal-close">
                <X aria-hidden="true" size={14} />
              </Modal.CloseTrigger>
            )}
          </Modal.Header>
          {children}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function DialogFooter({ className, children }: { className?: string; children?: ReactNode }) {
  return <Modal.Footer className={cn("mt-5 flex justify-end gap-2", className)}>{children}</Modal.Footer>;
}
