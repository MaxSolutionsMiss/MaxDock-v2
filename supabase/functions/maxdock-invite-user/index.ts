// MaxDock DB28 Supabase Edge Function: maxdock-invite-user
// Deploy this file as the function's index.ts. Keep "Verify JWT with legacy secret" OFF.
//
// Kept in the repository from the day Carrier was added as an external party type. Until then
// this function existed only as a deployed artefact: nothing in the tree recorded what it did,
// nothing reviewed a change to it, and a redeploy could not be diffed against what it replaced.

import { createClient } from "npm:@supabase/supabase-js@2.110.3";

// Where an invited person and a password reset are sent.
//
// `/?mode=setup` is this application's own login page, index.html, which already carries the
// panel that sets a password: it handles the mode, it handles the PASSWORD_RECOVERY event, and
// the client is created with detectSessionInUrl so the tokens in the link establish a session
// before the panel is shown. It is also where this application's own "forgot password" sends
// people, so both routes end on one screen with one set of validation and one set of messages.
//
// It used to be `/set-password.html`, which is a page that exists only in the v1 repository.
// That made a static site nobody was still developing into a live dependency of every invitation,
// and it is why retiring v1 could not start: rename or delete that repository and the next person
// invited lands on a 404 with nothing to act on. This is the line that unpicks it.
//
// The fallback moved with it, and it had to. It named v1's db04 folder, and v1 does not
// understand `?mode=setup` -- it has the separate page this function no longer points at. Leaving
// the two out of step would mean a deploy without the secret set sent people to a host that
// cannot serve the route they were sent to, which is a worse failure than the one being fixed
// because it looks like nothing is wrong until somebody tries to accept an invitation.
//
// So the pair is now coherent: this function targets this application, with or without the
// variable. That makes deploying it a decision rather than a formality. Deploy it together with
// setting MAXDOCK_APP_URL, in the same sitting, and not while v1 is still the application people
// are being invited to -- see docs/RENAME-RUNBOOK.md step 2.
const appUrl = (Deno.env.get("MAXDOCK_APP_URL") ??
  "https://maxsolutionsmiss.github.io/MaxDock").replace(/\/$/, "");
const allowedOrigin = new URL(appUrl).origin;

function corsHeaders(request: Request): Record<string, string> {
  const requestOrigin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function response(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders(request), "Content-Type": "application/json"}
  });
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validUsername(value: string) {
  return /^[A-Za-z0-9._-]{3,50}$/.test(value);
}

// The three kinds of party outside Max Solutions, all on the one `customer` role. This list has
// to agree with the check constraint on public.profiles, the same list inside
// public.admin_update_user, and EXTERNAL_PARTY_TYPES in js/pages/users.js.
const EXTERNAL_PARTY_TYPES = ["Customer", "Vendor", "Carrier"];

function generateTemporaryPassword() {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%*-_"
  ];
  const alphabet = groups.join("");
  const randomIndex = (length: number) => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % length;
  };
  const characters = groups.map(group => group[randomIndex(group.length)]);
  while (characters.length < 18) {
    characters.push(alphabet[randomIndex(alphabet.length)]);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {headers: corsHeaders(request)});
  }
  if (request.method !== "POST") {
    return response(request, 405, {error: "Method not allowed."});
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response(request, 500, {error: "The MaxDock account service is not configured."});
  }

  try {
    const input = await request.json();
    const action = String(input.action ?? "create_invite_link");
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {persistSession: false, autoRefreshToken: false}
    });

    if (action === "username_login") {
      const username = String(input.username ?? "").trim().toLowerCase();
      const password = String(input.password ?? "");
      if (!validUsername(username) || !password || password.length > 256) {
        return response(request, 401, {error: "Sign-in failed. Check your username and password."});
      }

      const {data: profile} = await serviceClient
        .from("profiles")
        .select("id")
        .ilike("username", username)
        .eq("is_active", true)
        .maybeSingle();
      if (!profile) {
        return response(request, 401, {error: "Sign-in failed. Check your username and password."});
      }

      const {data: authUserData, error: authUserError} =
        await serviceClient.auth.admin.getUserById(profile.id);
      const authEmail = authUserData.user?.email;
      if (authUserError || !authEmail) {
        return response(request, 401, {error: "Sign-in failed. Check your username and password."});
      }

      const authClient = createClient(supabaseUrl, anonKey, {
        auth: {persistSession: false, autoRefreshToken: false}
      });
      const {data: signInData, error: signInError} =
        await authClient.auth.signInWithPassword({email: authEmail, password});
      if (signInError || !signInData.session) {
        return response(request, 401, {error: "Sign-in failed. Check your username and password."});
      }

      return response(request, 200, {
        accessToken: signInData.session.access_token,
        refreshToken: signInData.session.refresh_token
      });
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return response(request, 401, {error: "A signed-in System Admin is required."});

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {persistSession: false, autoRefreshToken: false}
    });
    const {data: userData, error: userError} = await authClient.auth.getUser(token);
    if (userError || !userData.user) {
      return response(request, 401, {error: "The MaxDock login session is invalid or expired."});
    }

    const {data: actor, error: actorError} = await serviceClient
      .from("profiles")
      .select("role_code,is_active")
      .eq("id", userData.user.id)
      .single();
    if (actorError || !actor?.is_active || actor.role_code !== "system_admin") {
      return response(request, 403, {error: "Only a MaxDock System Admin can manage user access."});
    }

    if (action === "reset_password") {
      const userId = String(input.userId ?? "").trim();
      if (!userId) return response(request, 400, {error: "A MaxDock user is required."});
      if (userId === userData.user.id) {
        return response(request, 400, {error: "Use the normal password-change page for your own System Admin account."});
      }

      const {data: target, error: targetError} = await serviceClient
        .from("profiles")
        .select("id,username,full_name,is_active,must_change_password")
        .eq("id", userId)
        .maybeSingle();
      if (targetError || !target) {
        return response(request, 404, {error: "The MaxDock user was not found."});
      }
      if (!target.is_active) {
        return response(request, 400, {error: "Reactivate this user before resetting their password."});
      }

      const temporaryPassword = generateTemporaryPassword();
      const {error: profileError} = await serviceClient
        .from("profiles")
        .update({must_change_password: true, updated_at: new Date().toISOString()})
        .eq("id", userId);
      if (profileError) return response(request, 400, {error: profileError.message});

      const {error: passwordError} = await serviceClient.auth.admin.updateUserById(userId, {
        password: temporaryPassword
      });
      if (passwordError) {
        await serviceClient
          .from("profiles")
          .update({must_change_password: target.must_change_password})
          .eq("id", userId);
        return response(request, 400, {error: passwordError.message});
      }

      const {error: auditError} = await serviceClient.from("user_admin_audit_log").insert({
        actor_user_id: userData.user.id,
        target_user_id: userId,
        target_username: target.username,
        action: "password_reset",
        details: {must_change_password: true, credential_delivery: "manual"}
      });
      if (auditError) console.error("MaxDock password-reset audit failed", auditError.message);

      return response(request, 200, {
        userId,
        username: target.username,
        fullName: target.full_name,
        password: temporaryPassword,
        message: `A temporary password was created for ${target.username}.`
      });
    }

    if (action === "update_username") {
      const userId = String(input.userId ?? "").trim();
      const username = String(input.username ?? "").trim().toLowerCase();
      if (!validUsername(username)) {
        return response(request, 400, {error: "Use a username with 3-50 letters, numbers, dots, dashes, or underscores."});
      }

      const {data: target, error: targetError} = await serviceClient
        .from("profiles")
        .select("id,username")
        .eq("id", userId)
        .maybeSingle();
      if (targetError || !target) {
        return response(request, 404, {error: "The MaxDock user was not found."});
      }

      const {data: duplicate, error: duplicateError} = await serviceClient
        .from("profiles")
        .select("id")
        .ilike("username", username)
        .neq("id", userId)
        .maybeSingle();
      if (duplicateError) return response(request, 400, {error: duplicateError.message});
      if (duplicate) return response(request, 409, {error: "That username is already in use."});

      const {error: profileError} = await serviceClient
        .from("profiles")
        .update({username})
        .eq("id", userId);
      if (profileError) return response(request, 400, {error: profileError.message});

      const {data: authUserData, error: authUserError} =
        await serviceClient.auth.admin.getUserById(userId);
      if (authUserError || !authUserData.user) {
        await serviceClient.from("profiles").update({username: target.username}).eq("id", userId);
        return response(request, 400, {error: "The Supabase Auth user could not be updated."});
      }

      const {error: metadataError} = await serviceClient.auth.admin.updateUserById(userId, {
        user_metadata: {...(authUserData.user.user_metadata ?? {}), username}
      });
      if (metadataError) {
        await serviceClient.from("profiles").update({username: target.username}).eq("id", userId);
        return response(request, 400, {error: metadataError.message});
      }

      return response(request, 200, {userId, username, message: "Username updated."});
    }

    if (action === "delete_user") {
      const userId = String(input.userId ?? "").trim();
      if (!userId) return response(request, 400, {error: "A MaxDock user is required."});
      if (userId === userData.user.id) {
        return response(request, 400, {error: "You cannot delete your own System Admin account."});
      }

      const {data: target, error: targetError} = await serviceClient
        .from("profiles")
        .select("id,username,full_name")
        .eq("id", userId)
        .maybeSingle();
      if (targetError || !target) {
        return response(request, 404, {error: "The MaxDock user was not found."});
      }

      const {error: deleteError} = await serviceClient.auth.admin.deleteUser(userId);
      if (deleteError) return response(request, 400, {error: deleteError.message});

      return response(request, 200, {
        userId,
        username: target.username,
        message: `${target.full_name || target.username} was deleted. Appointment history was preserved.`
      });
    }

    if (action === "generate_existing_link") {
      const userId = String(input.userId ?? "").trim();
      const {data: profile, error: profileError} = await serviceClient
        .from("profiles")
        .select("username,full_name,contact_email,is_active")
        .eq("id", userId)
        .maybeSingle();
      if (profileError || !profile?.is_active) {
        return response(request, 404, {error: "An active MaxDock user was not found."});
      }

      const {data: authUserData, error: authUserError} =
        await serviceClient.auth.admin.getUserById(userId);
      const authEmail = authUserData.user?.email;
      if (authUserError || !authEmail) {
        return response(request, 400, {error: "This user does not have a usable Supabase Auth account."});
      }

      const {data: linkData, error: linkError} = await serviceClient.auth.admin.generateLink({
        type: "recovery",
        email: authEmail,
        options: {redirectTo: `${appUrl}/?mode=setup`}
      });
      const invitationLink = linkData?.properties?.action_link;
      if (linkError || !invitationLink) {
        return response(request, 400, {error: linkError?.message ?? "The setup link could not be created."});
      }
      return response(request, 200, {
        invitationLink,
        contactEmail: profile.contact_email ?? "",
        username: profile.username
      });
    }

    if (action !== "create_invite_link" && action !== "create_temporary_password") {
      return response(request, 400, {error: "Unknown MaxDock account action."});
    }

    const username = String(input.username ?? "").trim().toLowerCase();
    const email = String(input.email ?? "").trim().toLowerCase();
    const fullName = String(input.fullName ?? "").trim();
    const roleCode = String(input.roleCode ?? "").trim();
    const externalPartyType = roleCode === "customer" ? String(input.externalPartyType ?? "").trim() : "";
    const organizationName = roleCode === "customer" ? String(input.organizationName ?? "").trim() : "";
    const password = String(input.password ?? "");
    let locationIds = [...new Set(
      (Array.isArray(input.locationIds) ? input.locationIds : [])
        .map(value => String(value).trim())
        .filter(Boolean)
    )];

    if (!validUsername(username)) {
      return response(request, 400, {error: "Use a username with 3-50 letters, numbers, dots, dashes, or underscores."});
    }
    if (!fullName) return response(request, 400, {error: "Full name is required."});
    if (roleCode === "customer" && !EXTERNAL_PARTY_TYPES.includes(externalPartyType)) {
      return response(request, 400, {error: "Choose Customer, Vendor or Carrier as the outside account type."});
    }
    if (roleCode === "customer" && !organizationName) {
      return response(request, 400, {error: "Company name is required for an outside access account."});
    }
    if (action === "create_invite_link" && !validEmail(email)) {
      return response(request, 400, {error: "Enter a valid email address for the invitation link."});
    }
    if (action === "create_temporary_password" && email && !validEmail(email)) {
      return response(request, 400, {error: "Enter a valid contact email or leave it blank."});
    }
    if (action === "create_temporary_password" && (password.length < 6 || password.length > 128)) {
      return response(request, 400, {error: "The temporary password must contain 6-128 characters."});
    }

    const {data: existingUsername} = await serviceClient
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (existingUsername) return response(request, 409, {error: "That username is already in use."});

    const {data: role, error: roleError} = await serviceClient
      .from("roles")
      .select("code")
      .eq("code", roleCode)
      .eq("is_active", true)
      .maybeSingle();
    if (roleError || !role) return response(request, 400, {error: "The selected role is invalid."});
    if (roleCode !== "system_admin" && locationIds.length === 0) {
      return response(request, 400, {error: "At least one active MaxDock location is required."});
    }

    if (locationIds.length) {
      const {data: locations, error: locationError} = await serviceClient
        .from("locations")
        .select("id")
        .in("id", locationIds)
        .eq("is_active", true);
      if (locationError || (locations ?? []).length !== locationIds.length) {
        return response(request, 400, {error: "One or more selected locations are invalid."});
      }
    }

    const authEmail = action === "create_temporary_password"
      ? (email || `${username}@maxdock.internal`)
      : email;
    let createdUserId = "";
    let invitationLink = "";

    if (action === "create_invite_link") {
      const {data: linkData, error: linkError} = await serviceClient.auth.admin.generateLink({
        type: "invite",
        email: authEmail,
        options: {
          redirectTo: `${appUrl}/?mode=setup`,
          data: {username, full_name: fullName}
        }
      });
      createdUserId = linkData?.user?.id ?? "";
      invitationLink = linkData?.properties?.action_link ?? "";
      if (linkError || !createdUserId || !invitationLink) {
        const status = /already|registered|exists/i.test(linkError?.message ?? "") ? 409 : 400;
        return response(request, status, {error: linkError?.message ?? "The invitation link could not be created."});
      }
    } else {
      const {data: createData, error: createError} = await serviceClient.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: {username, full_name: fullName}
      });
      createdUserId = createData.user?.id ?? "";
      if (createError || !createdUserId) {
        const status = /already|registered|exists/i.test(createError?.message ?? "") ? 409 : 400;
        return response(request, status, {error: createError?.message ?? "The temporary-password account could not be created."});
      }
    }

    try {
      const {error: profileError} = await serviceClient
        .from("profiles")
        .update({
          username,
          full_name: fullName,
          contact_email: email || null,
          role_code: roleCode,
          external_party_type: externalPartyType || null,
          organization_name: organizationName || null,
          is_active: true,
          must_change_password: true
        })
        .eq("id", createdUserId)
        .select("id")
        .single();
      if (profileError) throw profileError;

      const {error: clearError} = await serviceClient
        .from("user_location_access")
        .delete()
        .eq("user_id", createdUserId);
      if (clearError) throw clearError;

      if (locationIds.length) {
        const {error: accessError} = await serviceClient
          .from("user_location_access")
          .insert(locationIds.map(locationId => ({
            user_id: createdUserId,
            location_id: locationId,
            granted_by: userData.user.id
          })));
        if (accessError) throw accessError;
      }
    } catch (setupError) {
      await serviceClient.auth.admin.deleteUser(createdUserId);
      throw setupError;
    }

    return response(request, 201, {
      user: {id: createdUserId, username, email, fullName, roleCode, externalPartyType, organizationName, locationIds},
      invitationLink: invitationLink || undefined,
      method: action === "create_temporary_password" ? "temporary_password" : "invite_link",
      message: action === "create_temporary_password"
        ? `Temporary login created for ${username}.`
        : `Invitation link created for ${email}.`
    });
  } catch (error: unknown) {
    return response(request, 500, {
      error: error instanceof Error ? error.message : "Unexpected MaxDock account service error."
    });
  }
});
