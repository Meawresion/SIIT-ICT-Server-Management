// Events to the other services on AWS (D34): the backend puts them on the EventBridge bus
// EVENT_BUS_NAME, and each consuming service reads them from its own SQS queue. Services never
// call each other directly.
//   source siit.backend, detail-type "Email requested": { to, subject, text, html } for the
//   notification service, which alone holds the SMTP settings.

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export const EVENT_SOURCE = 'siit.backend';
export const EMAIL_REQUESTED = 'Email requested';

// -> { publish(detailType, detail) }: resolves once EventBridge accepted the event.
export function createEventPublisher({ busName, client = new EventBridgeClient({}) }) {
  return {
    async publish(detailType, detail) {
      const res = await client.send(new PutEventsCommand({ Entries: [{
        EventBusName: busName, Source: EVENT_SOURCE, DetailType: detailType, Detail: JSON.stringify(detail),
      }] }));
      if (res.FailedEntryCount) {
        const [entry] = res.Entries ?? [];
        throw new Error(`EventBridge refused the event: ${entry?.ErrorCode ?? 'unknown'} ${entry?.ErrorMessage ?? ''}`.trim());
      }
    },
  };
}
