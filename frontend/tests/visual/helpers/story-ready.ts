import { expect, type Page } from "@playwright/test";
import { PLAY_FUNCTION_THREW_EXCEPTION, STORY_ERRORED, STORY_FINISHED, STORY_THREW_EXCEPTION, type StoryFinishedPayload } from "storybook/internal/core-events";

export const STORYBOOK_ORIGIN = process.env.ORBIS_VISUAL_STORYBOOK_ORIGIN ?? "http://127.0.0.1:9322";

type StoryWindow = Window & {
  __STORYBOOK_ADDONS_CHANNEL__?: { last: (event: string) => unknown[] | undefined };
};
type StoryReadiness = {
  finished?: StoryFinishedPayload;
  failures: Array<{ event: string; args: unknown[] }>;
};

// channel.last 保留当前文档的事件；调用方每个新 Page 只导航一个 Story。
export async function waitForStoryReady(page: Page, storyId: string): Promise<StoryFinishedPayload> {
  const handle = await page.waitForFunction(({ storyId, finishedEvent, errorEvents }) => {
    const channel = (window as StoryWindow).__STORYBOOK_ADDONS_CHANNEL__;
    const failures = errorEvents.flatMap(event => {
      const args = channel?.last(event);
      return args ? [{ event, args: args.map(value => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value) }] : [];
    });
    if (failures.length) return { failures };
    const finished = channel?.last(finishedEvent)?.[0] as StoryFinishedPayload | undefined;
    return finished?.storyId === storyId ? { finished, failures } : false;
  }, { storyId, finishedEvent: STORY_FINISHED, errorEvents: [PLAY_FUNCTION_THREW_EXCEPTION, STORY_THREW_EXCEPTION, STORY_ERRORED] });
  const result = await handle.jsonValue() as StoryReadiness;
  if (result.failures.length) {
    const details = result.failures.map(({ event, args }) => `[${event}]\n${JSON.stringify(args, null, 2)}`).join("\n");
    throw new Error(`Story ${storyId} failed before visual actions:\n${details}`, { cause: result.failures });
  }
  expect(result.finished, `${storyId} must finish successfully before visual actions`).toMatchObject({ status: "success" });
  return result.finished!;
}
