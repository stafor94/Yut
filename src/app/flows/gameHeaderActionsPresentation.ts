type SeatIdentity = {
  id: string;
  label?: string;
};

let sequenceExportVisible = false;
const sequenceExportListeners = new Set<() => void>();

export function isLocalPlayerOne(seats: readonly SeatIdentity[], localSeatId: string) {
  if (!localSeatId) return false;
  const playerOne = seats.find((seat) => seat.label === 'P1') ?? seats[0];
  return playerOne?.id === localSeatId;
}

export function getSequenceExportVisible() {
  return sequenceExportVisible;
}

export function subscribeSequenceExportVisible(listener: () => void) {
  sequenceExportListeners.add(listener);
  return () => sequenceExportListeners.delete(listener);
}

export function publishSequenceExportVisible(visible: boolean) {
  if (sequenceExportVisible === visible) return;
  sequenceExportVisible = visible;
  sequenceExportListeners.forEach((listener) => listener());
}
