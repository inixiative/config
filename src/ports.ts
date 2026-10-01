import registry from '../ports.json';

export type Service = keyof typeof registry.services;
export type Project = keyof typeof registry.projects;

export const projects = Object.keys(registry.projects) as Project[];
export const services = Object.keys(registry.services) as Service[];

/** A project's local port for each service: the service default, offset by the project's block. */
export function portsFor(project: Project): Record<Service, number> {
  const offset = registry.projects[project] * registry.blockSize;
  return Object.fromEntries(
    services.map((service) => [service, registry.services[service] + offset]),
  ) as Record<Service, number>;
}

/** Ports claimed twice, or a project sitting on a default; empty when the registry is sound. */
export function portConflicts(): string[] {
  const claimed = new Map<number, string>(
    Object.entries(registry.reserved).map(([port, owner]) => [Number(port), owner]),
  );
  for (const [service, port] of Object.entries(registry.services))
    claimed.set(port, `default ${service}`);
  const conflicts: string[] = [];
  for (const project of projects)
    for (const [service, port] of Object.entries(portsFor(project))) {
      const label = `${project} ${service}`;
      const other = claimed.get(port);
      if (other) conflicts.push(`${port}: ${label} collides with ${other}`);
      claimed.set(port, label);
    }
  return conflicts;
}
