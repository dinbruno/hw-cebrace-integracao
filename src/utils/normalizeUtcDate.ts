export function dateToUTC(data: Date) {
  if (!data) return null;
  const originalDate = new Date(data);
  originalDate.setHours(originalDate.getHours() + 3);
  return originalDate.toISOString();
}
