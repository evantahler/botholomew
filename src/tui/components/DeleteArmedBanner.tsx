import { Box, Text } from "ink";
import { theme } from "../theme.ts";

interface DeleteArmedBannerProps {
  armed: boolean;
  label: string | null;
}

export function DeleteArmedBanner({ armed, label }: DeleteArmedBannerProps) {
  if (!armed) return null;
  return (
    <Box>
      <Text color={theme.error} bold>
        ⚠ Press d again to delete {label ?? ""} (any other key cancels)
      </Text>
    </Box>
  );
}
