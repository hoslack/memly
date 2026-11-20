/**
 * Ownership & Authorization Guard Utilities.
 * Never trusts client-supplied user IDs for authorization without matching the authenticated caller.
 */

export class AuthorizationError extends Error {
  public readonly statusCode: number;
  constructor(message = "Forbidden: You do not have permission to access this resource.", statusCode = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.statusCode = statusCode;
  }
}

export interface OwnedResource {
  userId: string;
}

/**
 * Verifies that an authenticated user ID exists and matches the resource's owner userId.
 */
export function assertResourceOwnership<T extends OwnedResource>(
  authenticatedUserId: string | null | undefined,
  resource: T | null | undefined,
  resourceName = "Deck"
): T {
  if (!authenticatedUserId || authenticatedUserId.trim().length === 0) {
    throw new AuthorizationError("Authentication required.", 401);
  }

  if (!resource) {
    throw new AuthorizationError(`${resourceName} not found.`, 404);
  }

  if (resource.userId !== authenticatedUserId) {
    throw new AuthorizationError(
      `Forbidden: You do not own this ${resourceName.toLowerCase()}.`,
      403
    );
  }

  return resource;
}
