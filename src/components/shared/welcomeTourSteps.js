import { ROLES, isRedRole } from '../../data/constants';

const descriptions = {
  growth: 'See how the church is growing. Review member counts and trends over time.',
  staff: 'Review church staff and their activity. Open a staff record to see the details available to you.',
  members: 'Search the church directory by name. Select a name to open the member’s details.',
  kdf: 'Find a KDF area and see its members and activity. Select an area to review its details.',
  departments: 'Browse church departments. Choose a department to review its members and activity.',
  followups: 'Review pastoral follow-ups. Use the list and filters to find visits, outcomes, and people who still need contact.',
  programmes: 'Review programme attendance. Choose a programme to see its records or use the check-in tools available to your role.',
  communication: 'Send church announcements. Choose a channel and audience, then review your message before sending.',
  reports: 'Review submitted church reports for the period you need.',
  assignments: 'Review assignments and add or update who is responsible for each task.',
  red: 'Manage Project 3000. Generate leader invitations, review teams and reports, and adjust campaign settings.',
  users: 'Create and manage sign-in accounts. Open an account to review its role or use the available security actions.',
  approvals: 'Open a correction request, review its details, and approve or reject it.',
  audit: 'See who changed a record and when. Use the filters to find the action you want to review.',
  insights: 'Review church trends and download the exports available to you.',
  attendance: 'Choose a service, department, or date to review attendance. Open the recording form to enter a count.',
  settings: 'Review the administrative settings available to your account.',
  register: 'Add someone to the church records. Enter their details, confirm their consent, and save.',
  myMembers: 'Find the people assigned to you. Open a member profile to review their details and activity.',
  followup: 'Record a call, visit, or other follow-up. Choose a member, add the outcome, and save.',
  deptMembers: 'Browse members of your department. Select someone to open their profile.',
  kdfMembers: 'Browse members of your KDF area. Select someone to open their profile.',
  security: 'Change your password, manage two-step verification, and review the devices signed in to your account.',
  'red-souls': 'Review the souls you recorded. Open a record for its details or use the stage button when the person is ready to move forward.',
  'red-add': 'Enter a person’s name and address, confirm that they agreed to follow-up, and save. An entry saved offline syncs when you reconnect.',
  'red-board': 'See how teams are doing this month and how close the campaign is to its goal.',
  'red-join': 'Copy your team’s join link or share it on WhatsApp. You can replace it when you need a new one.',
};

function describePage(key, role) {
  const leader = role === ROLES.RED_LEADER;
  const manager = role === ROLES.BISHOP || role === ROLES.ADMIN;
  if (key === 'red-team') return leader
    ? 'See your roster, each person’s progress, and the souls they recorded. Use this page to open your join link or submit a report when the window opens.'
    : 'See who leads your team and how many people have joined.';
  if (key === 'reports' && !manager) return 'Choose a reporting period, then review the figures or submit the report available to your role.';
  if (key === 'approvals' && !manager) return 'See the corrections you requested. Open a request to check its status and any decision.';
  if (key === 'attendance' && role === ROLES.DEPARTMENT_LEADER) return 'Choose a service and date to record your department’s attendance or review previous entries.';
  return descriptions[key];
}

export function welcomeTourSteps(navigation, dockKeys, role, mobile) {
  const red = isRedRole(role);
  const visible = navigation.filter(page => page.key !== 'overview' && describePage(page.key, role));
  const pages = mobile ? [
    ...dockKeys.flatMap(key => visible.filter(page => page.key === key)),
    ...visible.filter(page => !dockKeys.includes(page.key)),
  ] : visible;

  return [
    {
      id: 'home', target: 'page-overview', title: 'Welcome to SICC Admin',
      text: red
        ? 'Home shows your Operation R.E.D. dashboard. See how many souls you’ve recorded and how you’re progressing toward your monthly target.'
        : 'Home shows the information and tasks for your role. Use it to see what needs attention and get back to your daily work.',
      cue: mobile ? 'Tap Home in the bottom menu.' : 'Select your overview in the sidebar.',
    },
    ...pages.map(page => {
      const underMore = mobile && !dockKeys.includes(page.key);
      const dockLabel = page.key === 'red-board' ? 'Teams' : dockKeys[1] === page.key && !red ? 'Members' : page.label;
      return {
        id: page.key, target: underMore ? 'more' : `page-${page.key}`, title: page.label,
        text: describePage(page.key, role),
        cue: underMore ? `Open More and choose ${page.label}.` : mobile ? `Use ${dockLabel} in the bottom menu.` : undefined,
      };
    }),
    {
      id: 'search', target: 'search', title: 'Search',
      text: red ? 'Open Search and type the name of an Operation R.E.D. page to go there quickly.'
        : 'Open Search and type a page or member name. Choose a result to open the page or record.',
    },
    {
      id: 'notifications', target: 'notifications', title: 'Notifications',
      text: 'Open the bell to check for updates. Select a notification to open it and mark that update as read.',
    },
    {
      id: 'account', target: 'account', title: 'Account menu',
      text: 'Select your initials to open Security & devices, change the theme, or sign out.',
    },
  ];
}
