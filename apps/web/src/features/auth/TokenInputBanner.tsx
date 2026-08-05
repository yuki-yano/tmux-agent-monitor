import { useMemo, useState } from "react";

import { Button, Card, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

type TokenInputBannerProps = {
  authError: string | null;
  onSubmit: (token: string) => void;
};

export const TokenInputBanner = ({ authError, onSubmit }: TokenInputBannerProps) => {
  const [tokenDraft, setTokenDraft] = useState("");
  const canSubmit = tokenDraft.trim().length > 0;
  const helperText = useMemo(() => {
    if (authError == null) {
      return "Set access token to continue.";
    }
    return authError;
  }, [authError]);
  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(tokenDraft.trim());
    setTokenDraft("");
  };

  return (
    <Card className="mx-auto flex w-full max-w-xl flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-latte-text text-base font-semibold sm:text-lg">
          Authentication required
        </h2>
        <p className={cn("text-sm", authError ? "text-latte-red-text" : "text-latte-subtext0")}>
          {helperText}
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <Input
          value={tokenDraft}
          onChange={(event) => setTokenDraft(event.currentTarget.value)}
          placeholder="Paste access token"
          autoComplete="off"
          spellCheck={false}
          type="password"
        />
        <Button type="submit" disabled={!canSubmit}>
          Save token
        </Button>
      </form>
      <p className="text-latte-subtext0 text-xs">
        Re-open the URL from CLI output (`#token=...`) if you need a new token link.
      </p>
    </Card>
  );
};
