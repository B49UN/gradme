import "server-only";

const SERVICE_NAME = "GradMe";

async function loadKeytar() {
  try {
    const keytar = await import("keytar");
    return keytar.default ?? keytar;
  } catch {
    return null;
  }
}

export async function isKeytarAvailable() {
  return Boolean(await loadKeytar());
}

export async function storeApiKey(profileId: string, apiKey: string) {
  const keytar = await loadKeytar();

  if (!keytar) {
    return false;
  }

  await keytar.setPassword(SERVICE_NAME, profileId, apiKey);
  return true;
}

export async function readApiKey(profileId: string) {
  const keytar = await loadKeytar();

  if (!keytar) {
    return null;
  }

  return keytar.getPassword(SERVICE_NAME, profileId);
}
