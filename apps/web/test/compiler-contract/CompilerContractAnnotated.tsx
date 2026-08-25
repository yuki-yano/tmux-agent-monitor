export const CompilerContractAnnotated = function CompilerContractAnnotated({
  value,
}: {
  value: number;
}) {
  "use memo";

  return <span>{value * 2}</span>;
};
