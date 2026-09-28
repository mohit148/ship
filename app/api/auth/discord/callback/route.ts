import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, fetchDiscordUser, discordAvatarUrl } from "@/lib/discord";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/data/config";
import { devStore } from "@/lib/data/dev-store";
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(new URL("/?error=discord_denied", req.url));
  }

  let redirectTo = "/";
  if (stateRaw) {
    try {
      redirectTo = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8")).redirectTo ?? "/";
    } catch {
      // ignore malformed state, fall back to home
    }
  }

  try {
    const token = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordUser(token.access_token);
    const avatarUrl = discordAvatarUrl(discordUser);
    const adminIds = (process.env.ADMIN_DISCORD_IDS ?? "").split(",").map((s) => s.trim());
    const isAdmin = adminIds.includes(discordUser.id);

    // Upsert into `users` so this person shows up in search / the ship list
    // even before they're part of a ship. Uses the service-role client since
    // this runs before we have a session to authenticate as the user.
    if (isSupabaseConfigured()) {
      const supabase = createServiceRoleClient();
      await supabase.from("users").upsert({
        discord_id: discordUser.id,
        username: discordUser.username,
        display_name: discordUser.global_name,
        avatar_url: avatarUrl,
        is_admin: isAdmin,
      });
    } else {
      devStore.update((s) => {
        const existing = s.users.find((u) => u.id === discordUser.id);
        if (existing) {
          existing.username = discordUser.username;
          existing.displayName = discordUser.global_name;
          existing.avatarUrl = avatarUrl;
          existing.isAdmin = isAdmin;
        } else {
          s.users.push({
            id: discordUser.id,
            username: discordUser.username,
            displayName: discordUser.global_name,
            avatarUrl,
            isAdmin,
          });
        }
      });
    }

    const res = NextResponse.redirect(new URL(redirectTo, req.url));
    res.cookies.set(
      SESSION_COOKIE_NAME,
      createSessionCookieValue({
        discordId: discordUser.id,
        username: discordUser.username,
        displayName: discordUser.global_name,
        avatarUrl,
        isAdmin,
        issuedAt: Date.now(),
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      }
    );
    return res;
  } catch (err) {
    console.error("Discord OAuth callback failed", err);
    return NextResponse.redirect(new URL("/?error=discord_failed", req.url));
  }
}
