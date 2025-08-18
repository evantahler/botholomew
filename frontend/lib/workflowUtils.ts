export const getStepTypeColor = (stepType: string) => {
  const colors: Record<string, string> = {
    agent: "primary",
    condition: "warning",
    loop: "info",
    webhook: "success",
    delay: "secondary",
    manual: "dark",
    timer: "light",
  };
  return colors[stepType] || "secondary";
};

export const getStepTypeDescription = (stepType: string) => {
  const descriptions: Record<string, string> = {
    agent: "Run an AI agent",
    condition: "Conditional logic branch",
    loop: "Repeat steps",
    webhook: "HTTP webhook call",
    delay: "Wait for specified time",
    manual: "Manual human intervention",
    timer: "Scheduled execution",
  };
  return descriptions[stepType] || "Unknown step type";
};
