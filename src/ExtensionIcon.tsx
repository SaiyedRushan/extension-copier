/** The extension's own icon, or its first letter on a plain tile when it has none. */
export function ExtensionIcon({ name, icon }: { name: string; icon: string | null }) {
  if (icon) return <img className="ext-icon" src={icon} alt="" />;
  return (
    <span className="ext-icon ext-icon-letter" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
