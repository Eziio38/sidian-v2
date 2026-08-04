import type { DashboardEvent } from "@/lib/dashboard/dashboard-model";
import {
  BusinessList,
  BusinessRow,
  EventMarker,
  EventTime,
  RowAmount,
  WorkspaceSection,
} from "@/components/app/workspace-blocks";
import {
  formatDashboardDateTime,
  formatEuroCents,
} from "@/lib/dashboard/format";

type DashboardEventsProps = {
  events: DashboardEvent[];
};

export function DashboardEvents({ events }: DashboardEventsProps) {
  return (
    <WorkspaceSection
      title="Derniers événements"
      description="Ce qui a changé, dans l’ordre."
    >
      {events.length === 0 ? (
        <p>
          Les confirmations de paiement et demandes de validation apparaîtront
          ici.
        </p>
      ) : (
        <BusinessList ordered ariaLabel="Derniers événements">
          {events.map((event) => (
            <BusinessRow
              key={event.id}
              leading={<EventMarker tone={event.tone} />}
              title={event.title}
              description={event.description}
              accessory={
                <>
                  <EventTime dateTime={event.occurredAt}>
                    {formatDashboardDateTime(event.occurredAt)}
                  </EventTime>
                  {event.amountCents !== null ? (
                    <RowAmount>
                      {formatEuroCents(event.amountCents)}
                    </RowAmount>
                  ) : null}
                </>
              }
            />
          ))}
        </BusinessList>
      )}
    </WorkspaceSection>
  );
}
