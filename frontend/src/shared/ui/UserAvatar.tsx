import { Avatar } from "@orbis/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import type { ComponentProps, CSSProperties } from "react";
import type { User } from "../api/schemas";
import { authStore, getAuthSessionKey } from "../auth/auth-store";
import { getAvatar } from "../auth/profile-api";
import { useOptionalAuthRequest } from "../auth/use-auth-request";

const IDENTITY_COLORS = ["blue", "mint", "violet", "rose", "amber", "cyan"] as const;
export function identityColor(identity: string): CSSProperties {
  let hash = 0;
  for (const character of identity) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return { "--identity-color": `var(--ob-icon-${IDENTITY_COLORS[hash % IDENTITY_COLORS.length]})` } as CSSProperties;
}
type UserAvatarProps = { user: User | null; size?: ComponentProps<typeof Avatar>["size"]; className?: string };
function AvatarImage({ user, size = "sm", className = "", src }: UserAvatarProps & { src?: string }) {
  const name = user?.display_name || user?.email || "Orbis";
  return <Avatar size={size} className={`identity-avatar bg-[color-mix(in_oklab,var(--identity-color)_14%,var(--ob-surface))] text-[color:var(--identity-color)] ${className}`} style={identityColor(user?.id || "orbis")}
    src={src} alt={`${name}的头像`} fallback={Array.from(name)[0]?.toUpperCase() || "O"} />;
}
function StoredAvatar(props: UserAvatarProps) {
  const auth = useOptionalAuthRequest();
  const state = useStore(authStore);
  const image = useQuery({
    queryKey: ["user-avatar", getAuthSessionKey(state), props.user?.id, props.user?.avatar_asset_id],
    queryFn: () => getAvatar(auth!),
    meta: { silent: true },
    enabled: Boolean(auth && props.user?.id === state.user?.id),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return <AvatarImage {...props} src={image.data?.data_url} />;
}
export function UserAvatar(props: UserAvatarProps) {
  return props.user?.avatar_asset_id ? <StoredAvatar {...props} /> : <AvatarImage {...props} />;
}
