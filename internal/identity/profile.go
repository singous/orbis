package identity

import (
	"context"
	"strings"
	"unicode/utf8"

	"orbis.local/orbis/internal/platform/fault"
)

const MaxProfileVersion int64 = 1<<53 - 1
const MaxDisplayNameLength = 120
const MaxBioLength = 500
const UnnamedUser = "未命名用户"

// Name supplies a presentation fallback without changing the stored nullable profile.
func (u User) Name() string {
	if u.DisplayName == nil {
		return UnnamedUser
	}
	return *u.DisplayName
}

type ProfileChange struct {
	UserID           string
	ExpectedVersion  int64
	NameSet, BioSet  bool
	DisplayName, Bio *string
	Timestamp        int64
}

// UpdateProfile preserves omitted fields and restricts updates to the authenticated account.
func (s *Service) UpdateProfile(ctx context.Context, actor Actor, change ProfileChange) (User, error) {
	if change.ExpectedVersion < 1 || change.ExpectedVersion > MaxProfileVersion {
		return User{}, fault.Field("body.expected_version", "资料版本号超出范围")
	}
	if !change.NameSet && !change.BioSet {
		return User{}, fault.Field("body", "至少提供一个资料字段")
	}
	if change.DisplayName != nil {
		name := strings.TrimSpace(*change.DisplayName)
		if n := utf8.RuneCountInString(name); n < 1 || n > MaxDisplayNameLength || strings.ContainsRune(name, 0) {
			return User{}, fault.Field("body.display_name", "显示名称须为 1 至 120 个字符且不能包含空字符")
		}
		change.DisplayName = &name
	}
	if change.Bio != nil {
		bio := strings.TrimSpace(*change.Bio)
		if utf8.RuneCountInString(bio) > MaxBioLength || strings.ContainsRune(bio, 0) {
			return User{}, fault.Field("body.bio", "简介不能超过 500 个字符且不能包含空字符")
		}
		change.Bio = &bio
	}
	change.UserID, change.Timestamp = actor.UserID, s.clock.Now().UnixMilli()
	return s.repo.UpdateProfile(ctx, change)
}
