import { Laptop, Moon, Sun } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { isThemePreference } from "@/lib/theme";
import { useTheme } from "@/state/theme-context";

type ThemeToggleProps = {
  className?: string;
};

const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const { preference, setPreference } = useTheme();

  const handleValueChange = (value: string) => {
    if (isThemePreference(value)) {
      setPreference(value);
    }
  };

  return (
    <Tabs value={preference} onValueChange={handleValueChange} className={className}>
      <TabsList aria-label="Theme selection">
        <TabsTrigger
          value="system"
          className="flex h-7 w-7 items-center justify-center p-0"
          aria-label="System theme"
          title="System"
        >
          <Laptop className="h-4 w-4" />
        </TabsTrigger>
        <TabsTrigger
          value="latte"
          className="flex h-7 w-7 items-center justify-center p-0"
          aria-label="Latte theme"
          title="Latte"
        >
          <Sun className="h-4 w-4" />
        </TabsTrigger>
        <TabsTrigger
          value="mocha"
          className="flex h-7 w-7 items-center justify-center p-0"
          aria-label="Mocha theme"
          title="Mocha"
        >
          <Moon className="h-4 w-4" />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

export { ThemeToggle };
