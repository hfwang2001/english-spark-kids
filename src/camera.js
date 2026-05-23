const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 }
  }
};

let activeStream = null;
let activeOwner = null;
let pendingStreamPromise = null;

export async function acquireSharedCamera(owner) {
  if (!owner) throw new Error("Camera owner is required.");

  if (activeStream && activeOwner === owner) return activeStream;

  if (pendingStreamPromise) {
    try {
      await pendingStreamPromise;
    } catch {}
  }

  if (activeStream && activeOwner !== owner) {
    releaseSharedCamera(activeOwner);
    await wait(80);
  }

  if (activeStream) {
    activeOwner = owner;
    return activeStream;
  }

  pendingStreamPromise = navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  try {
    activeStream = await pendingStreamPromise;
    activeOwner = owner;
    return activeStream;
  } finally {
    pendingStreamPromise = null;
  }
}

export function releaseSharedCamera(owner) {
  if (!activeStream) return;
  if (owner && activeOwner && owner !== activeOwner) return;
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  activeOwner = null;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
