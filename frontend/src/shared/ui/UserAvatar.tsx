import { Avatar } from "@heroui/react/avatar";
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
  return { "--identity-color": `var(--orbis-icon-${IDENTITY_COLORS[hash % IDENTITY_COLORS.length]})` } as CSSProperties;
}
type UserAvatarProps = { user: User | null; size?: ComponentProps<typeof Avatar>["size"]; className?: string };
function AvatarImage({ user, size = "sm", className = "", src }: UserAvatarProps & { src?: string }) {
  const name = user?.display_name || user?.email || "Orbis";
  return <Avatar size={size} className={`identity-avatar ${className}`} style={identityColor(user?.id || "orbis")}>
    {src ? <Avatar.Image src={src} alt={`${name}的头像`} /> : null}
    <Avatar.Fallback>{Array.from(name)[0]?.toUpperCase() || "O"}</Avatar.Fallback>
  </Avatar>;
}
function StoredAvatar(props: UserAvatarProps) {
  const auth = useOptionalAuthRequest();
  const state = useStore(authStore);
  const image = useQuery({
    queryKey: ["user-avatar", getAuthSessionKey(state), props.user?.id, props.user?.avatar_asset_id],
    queryFn: () => getAvatar(auth!),
    enabled: Boolean(auth && props.user?.id === state.user?.id),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return <AvatarImage {...props} src={image.data?.data_url} />;
}
export function UserAvatar(props: UserAvatarProps) {
  return props.user?.avatar_asset_id ? <StoredAvatar {...props} /> : <AvatarImage {...props} />;
}
