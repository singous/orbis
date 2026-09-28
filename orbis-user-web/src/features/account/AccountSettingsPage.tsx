import { TextArea } from "@heroui/react/textarea";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { AVATAR_MIME_TYPES, changeAvatar, getProfile, updateProfile, validateAvatar } from "../../shared/auth/profile-api";
import { Button } from "../../shared/ui/Button";
import { TextInput } from "../../shared/ui/TextInput";
import { showToast } from "../../shared/ui/Toast";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import { PageContainer } from "../../shared/ui/PageContainer";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { workspaceRoleLabel } from "../workspace/capabilities";

export function AccountSettingsPage() {
  const user = useStore(authStore, state => state.user);
  const workspace = useStore(authStore, state => state.workspace);
  const auth = useAuthRequest();
  const [name, setName] = useState(user?.display_name || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [pending, setPending] = useState(false);
  const bioId = useId();
  const edited = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  useEffect(() => {
    let disposed = false;
    getProfile(auth).then(profile => {
      if (disposed) return;
      authStore.getState().updateUser(profile, sessionKey);
      if (!edited.current) { setName(profile.display_name || ""); setBio(profile.bio || ""); }
    }).catch(() => { /* Existing session data remains available when offline. */ });
    return () => { disposed = true; };
  }, [sessionKey]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { showToast({ title: "请填写名称", tone: "danger" }); return; }
    setPending(true);
    try {
      const saved = await updateProfile(name, bio, auth);
      if (getAuthSessionKey(authStore.getState()) !== sessionKey) return;
      authStore.getState().updateUser(saved, sessionKey);
      setName(saved.display_name || ""); setBio(saved.bio || ""); edited.current = false;
      showToast({ title: "个人资料已保存", tone: "success" });
    } catch (error) {
      if (getAuthSessionKey(authStore.getState()) === sessionKey) showToast({ title: "保存失败", description: error instanceof Error ? error.message : "请重试。", tone: "danger" });
    } finally { setPending(false); }
  }
  async function saveAvatar(file: File | null) {
    if (file) {
      const error = validateAvatar(file);
      if (error) { showToast({ title: "无法上传头像", description: error, tone: "danger" }); return; }
    }
    setPending(true);
    try {
      const saved = await changeAvatar(file, auth);
      if (getAuthSessionKey(authStore.getState()) !== sessionKey) return;
      authStore.getState().updateUser(saved, sessionKey);
      showToast({ title: file ? "头像已更新" : "已恢复默认头像", tone: "success" });
    } catch (error) {
      if (getAuthSessionKey(authStore.getState()) === sessionKey) showToast({ title: "头像更新失败", description: error instanceof Error ? error.message : "请重试。", tone: "danger" });
    } finally { setPending(false); }
  }
  return <WorkspaceShell>
    <PageContainer title="个人资料" description="管理你的头像和个人信息。">
      <section className="workbench-settings-section" aria-label="个人资料">
        <div className="workbench-profile">
          <UserAvatar user={user} size="lg" className="workbench-profile-avatar" />
          <div className="profile-identity"><h2>{user?.display_name || "我的账号"}</h2><p>{user?.email}</p>
            <div className="profile-avatar-actions">
              <Button size="sm" disabled={pending} onPress={() => fileInput.current?.click()}>更换头像</Button>
              {user?.avatar_file_id ? <Button size="sm" variant="ghost" disabled={pending} onPress={() => void saveAvatar(null)}>移除头像</Button> : null}
            </div>
            <p className="profile-upload-help">PNG、JPEG 或 WebP，最大 2 MiB。上传后自动裁剪为方形并保存。</p>
            <input ref={fileInput} type="file" hidden accept={AVATAR_MIME_TYPES.join(",")} aria-label="选择头像图片" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void saveAvatar(file); }} />
          </div>
        </div>
        <form className="profile-edit-form" onSubmit={save}>
          <TextInput label="名称" value={name} maxLength={120} disabled={pending} onChange={event => { edited.current = true; setName(event.target.value); }} />
          <div className="profile-field"><label htmlFor={bioId}>个人简介</label><TextArea id={bioId} value={bio} maxLength={500} disabled={pending} onChange={event => { edited.current = true; setBio(event.target.value); }} placeholder="介绍一下自己，或写下你正在关注的事情。" /></div>
          <div className="profile-form-actions"><Button type="submit" variant="primary" disabled={pending}>{pending ? "保存中…" : "保存资料"}</Button></div>
        </form>
        <dl className="workbench-settings-list profile-workspace-info">
          <div><dt>工作空间</dt><dd>{workspace?.name || "私人工作空间"}</dd></div>
          <div><dt>角色</dt><dd>{workspaceRoleLabel(workspace?.role)}</dd></div>
        </dl>
      </section>
    </PageContainer>
  </WorkspaceShell>;
}
