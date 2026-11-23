/** Stacked layers: the Terraform violet plane over two Docker-blue strata. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 29 10 16 17 3 10Z" fill="#8F7BFF" />
      <path
        d="M3 16l13 7 13-7"
        fill="none"
        stroke="#3AA0FF"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M3 22l13 7 13-7"
        fill="none"
        stroke="#3AA0FF"
        strokeWidth="2.6"
        strokeLinejoin="round"
        opacity=".55"
      />
    </svg>
  );
}
