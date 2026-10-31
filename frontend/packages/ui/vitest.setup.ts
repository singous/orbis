import { setProjectAnnotations } from "@storybook/react-vite";
import * as a11y from "@storybook/addon-a11y/preview";
import preview from "./.storybook/preview";

setProjectAnnotations([a11y, preview]);
