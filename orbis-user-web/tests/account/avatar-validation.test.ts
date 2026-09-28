import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES, validateAvatar } from "../../src/shared/auth/profile-api";
import { identityColor } from "../../src/shared/ui/UserAvatar";

describe("avatar input and identity color", () => {
  it("accepts supported static image types at the size boundary", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(validateAvatar(new File([new Uint8Array(MAX_AVATAR_BYTES)], "avatar", { type }))).toBeNull();
    }
  });
  it("rejects oversized images and unsupported types before upload", () => {
    expect(validateAvatar(new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], "avatar.png", { type: "image/png" }))).toContain("2 MiB");
    expect(validateAvatar(new File(["<svg/>"], "avatar.svg", { type: "image/svg+xml" }))).toContain("PNG");
  });
  it("uses stable identity colors across renders with more than one available tone", () => {
    expect(identityColor("account-a")).toEqual(identityColor("account-a"));
    expect(identityColor("account-a")).not.toEqual(identityColor("account-b"));
  });
});
