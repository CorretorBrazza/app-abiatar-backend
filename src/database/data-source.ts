import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Booth } from '../booths/entities/booth.entity';
import { BoothWifi } from '../booths/entities/booth-wifi.entity';
import { BoothReceptionist } from '../booths/entities/booth-receptionist.entity';
import { BoothRuleSet } from '../booths/entities/booth-rule-set.entity';
import { OnboardingLink } from '../users/entities/onboarding-link.entity';
import { Presence } from '../presences/entities/presence.entity';
import { DeadManLog } from '../presences/entities/dead-man-log.entity';
import { Message } from '../messages/entities/message.entity';
import { MessageRecipient } from '../messages/entities/message-recipient.entity';
import { PushDeviceToken } from '../notifications/entities/push-device-token.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CreateAuditLogs1787000000000 } from './migrations/1787000000000-CreateAuditLogs';
import { AddReceptionAssignments1787000001000 } from './migrations/1787000001000-AddReceptionAssignments';
import { AddBoothRuleSets1787000002000 } from './migrations/1787000002000-AddBoothRuleSets';
import { AddBoothLifecycle1787000003000 } from './migrations/1787000003000-AddBoothLifecycle';
import { GeneralizeOnboardingLinks1787000004000 } from './migrations/1787000004000-GeneralizeOnboardingLinks';
import { ConfigurePresenceConfirmationWindow1787000005000 } from './migrations/1787000005000-ConfigurePresenceConfirmationWindow';
import { AddBrokerManagementState1787000006000 } from './migrations/1787000006000-AddBrokerManagementState';
import { CleanupAbiatarTestUsers1787000007000 } from './migrations/1787000007000-CleanupAbiatarTestUsers';
import { AddPasswordResetState1787000008000 } from './migrations/1787000008000-AddPasswordResetState';
import { ResetAbiatarTestForRecreation1787000009000 } from './migrations/1787000009000-ResetAbiatarTestForRecreation';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    Tenant,
    User,
    Booth,
    BoothWifi,
    BoothReceptionist,
    BoothRuleSet,
    OnboardingLink,
    Presence,
    DeadManLog,
    Message,
    MessageRecipient,
    PushDeviceToken,
    AuditLog,
  ],
  migrations: [CreateAuditLogs1787000000000, AddReceptionAssignments1787000001000, AddBoothRuleSets1787000002000, AddBoothLifecycle1787000003000, GeneralizeOnboardingLinks1787000004000, ConfigurePresenceConfirmationWindow1787000005000, AddBrokerManagementState1787000006000, CleanupAbiatarTestUsers1787000007000, AddPasswordResetState1787000008000, ResetAbiatarTestForRecreation1787000009000],
  migrationsRun: false,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
