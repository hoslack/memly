import * as admin from "firebase-admin";

export function isFirebaseAdminConfigured(): boolean {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  return Boolean(
    projectId &&
      projectId !== "your_project_id" &&
      clientEmail &&
      !clientEmail.includes("xxxxx") &&
      privateKey &&
      !privateKey.includes("YOUR_PRIVATE_KEY")
  );
}

export function getFirebaseAdminApp(): admin.app.App | null {
  if (!isFirebaseAdminConfigured()) {
    return null;
  }

  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

/**
 * Verifies a Firebase ID token from an Authorization Bearer header if provided.
 * Never trusts client-supplied raw user IDs when verifying Firebase Auth tokens.
 */
export async function verifyAuthHeaderToken(
  authHeader: string | null
): Promise<{ uid: string; email?: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const adminApp = getFirebaseAdminApp();
  if (!adminApp) {
    return null;
  }

  try {
    const decoded = await admin.auth(adminApp).verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return null;
  }
}
