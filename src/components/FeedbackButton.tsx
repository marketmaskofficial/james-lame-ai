import { useState } from "react";
import { MessageSquarePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitFeedback, FEEDBACK_CATEGORIES } from "@/lib/feedback.functions";

export const APP_VERSION = "beta-1.0.0";

type Props = {
  page: string;
  symbol?: string;
  timeframe?: string;
  projectId?: string;
  className?: string;
};

/**
 * Compact beta feedback entry point. Only safe context is attached
 * (page, symbol, timeframe, project id, app version) — never credentials,
 * tokens or script content.
 */
export function FeedbackButton({
  page,
  symbol,
  timeframe,
  projectId,
  className,
}: Props) {
  const send = useServerFn(submitFeedback);
  const [open, setOpen] = useState(false);
  const [category, setCategory] =
    useState<(typeof FEEDBACK_CATEGORIES)[number]>("Bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (message.trim().length < 3) {
      toast.error("Please describe the issue");
      return;
    }
    setBusy(true);
    try {
      await send({
        data: {
          category,
          message: message.trim(),
          page,
          ...(symbol ? { symbol } : {}),
          ...(timeframe ? { timeframe } : {}),
          ...(projectId ? { projectId } : {}),
          appVersion: APP_VERSION,
        },
      });
      toast.success("Thanks — feedback sent");
      setMessage("");
      setOpen(false);
    } catch {
      toast.error("Could not send feedback. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Send beta feedback"
        className={
          className ??
          "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        }
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Feedback
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send beta feedback</DialogTitle>
            <DialogDescription>
              We attach the page, symbol, timeframe and project id — nothing
              else.
            </DialogDescription>
          </DialogHeader>

          <Select
            value={category}
            onValueChange={(v) =>
              setCategory(v as (typeof FEEDBACK_CATEGORIES)[number])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What happened? What did you expect?"
            rows={5}
          />

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">
              {page}
              {symbol ? ` · ${symbol}` : ""}
              {timeframe ? ` · ${timeframe}` : ""}
            </span>
            <Button size="sm" onClick={() => void onSubmit()} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Send
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
