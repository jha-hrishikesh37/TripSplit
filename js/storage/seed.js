// Seed a realistic demo trip on first launch
export function createInitialDemoState() {
  const now = Date.now();
  const tripId = 'trip_goa_demo';
  const m1 = { id: 'mem_aarav', name: 'Aarav', isOrganizer: true };
  const m2 = { id: 'mem_priya', name: 'Priya', isOrganizer: false };
  const m3 = { id: 'mem_rohan', name: 'Rohan', isOrganizer: false };
  const m4 = { id: 'mem_sneha', name: 'Sneha', isOrganizer: false };

  const todayStr = new Date().toISOString().split('T')[0];

  const demoExpenses = [
    {
      id: 'exp_demo_1',
      tripId,
      title: 'Beachfront Villa (2 Nights)',
      amountPaise: 1440000, // ₹14,400.00
      category: 'Stay',
      date: todayStr,
      paidBy: 'mem_aarav',
      splitType: 'EQUAL',
      splits: [
        { memberId: 'mem_aarav', amountPaise: 360000, metaValue: 1 },
        { memberId: 'mem_priya', amountPaise: 360000, metaValue: 1 },
        { memberId: 'mem_rohan', amountPaise: 360000, metaValue: 1 },
        { memberId: 'mem_sneha', amountPaise: 360000, metaValue: 1 }
      ],
      createdBy: 'mem_aarav',
      createdAt: now - 86400000 * 2,
      updatedAt: now - 86400000 * 2,
      deleted: false
    },
    {
      id: 'exp_demo_2',
      tripId,
      title: 'Seafood Dinner at Brittos',
      amountPaise: 385000, // ₹3,850.00
      category: 'Food',
      date: todayStr,
      paidBy: 'mem_priya',
      splitType: 'EQUAL',
      splits: [
        { memberId: 'mem_aarav', amountPaise: 96250, metaValue: 1 },
        { memberId: 'mem_priya', amountPaise: 96250, metaValue: 1 },
        { memberId: 'mem_rohan', amountPaise: 96250, metaValue: 1 },
        { memberId: 'mem_sneha', amountPaise: 96250, metaValue: 1 }
      ],
      createdBy: 'mem_priya',
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
      deleted: false
    },
    {
      id: 'exp_demo_3',
      tripId,
      title: 'Scooter Rentals & Fuel',
      amountPaise: 240000, // ₹2,400.00
      category: 'Travel',
      date: todayStr,
      paidBy: 'mem_rohan',
      splitType: 'PERCENT',
      splits: [
        { memberId: 'mem_aarav', amountPaise: 60000, metaValue: 25 },
        { memberId: 'mem_priya', amountPaise: 60000, metaValue: 25 },
        { memberId: 'mem_rohan', amountPaise: 60000, metaValue: 25 },
        { memberId: 'mem_sneha', amountPaise: 60000, metaValue: 25 }
      ],
      createdBy: 'mem_rohan',
      createdAt: now - 43200000,
      updatedAt: now - 43200000,
      deleted: false
    },
    {
      id: 'exp_demo_4',
      tripId,
      title: 'Scuba & Water Sports',
      amountPaise: 450000, // ₹4,500.00 (Shared by 3 people)
      category: 'Activities',
      date: todayStr,
      paidBy: 'mem_sneha',
      splitType: 'EQUAL',
      splits: [
        { memberId: 'mem_aarav', amountPaise: 150000, metaValue: 1 },
        { memberId: 'mem_rohan', amountPaise: 150000, metaValue: 1 },
        { memberId: 'mem_sneha', amountPaise: 150000, metaValue: 1 }
      ],
      createdBy: 'mem_sneha',
      createdAt: now - 21600000,
      updatedAt: now - 21600000,
      deleted: false
    }
  ];

  return {
    version: 1,
    theme: null, // null means follow system prefers-color-scheme
    activeTripId: tripId,
    activeIdentities: { [tripId]: 'mem_aarav' },
    trips: [
      {
        id: tripId,
        name: 'Goa Weekend Getaway',
        organizerId: 'mem_aarav',
        members: [m1, m2, m3, m4],
        expenses: demoExpenses,
        settlements: [],
        createdAt: now - 86400000 * 3,
        updatedAt: now - 21600000,
        deleted: false
      }
    ]
  };
}
