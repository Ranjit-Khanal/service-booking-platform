// SPDX-License-Identifier: AGPL-3.0-only
export type ServiceCategory = 'beauty' | 'wellness' | 'consulting';

export type ServiceMedia = {
  category: ServiceCategory;
  categoryLabel: string;
  imageUrl: string;
  imageAlt: string;
  blurb: string;
};

/** Curated Unsplash photos — keyed by service-name keywords from seed data. */
const MEDIA_BY_KEYWORD: Array<{ match: RegExp; media: ServiceMedia }> = [
  {
    match: /hair|cut|salon|style/i,
    media: {
      category: 'beauty',
      categoryLabel: 'Beauty',
      imageUrl:
        'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80',
      imageAlt: 'Stylist working in a bright salon',
      blurb: 'Precision cuts in a calm, well-lit studio.',
    },
  },
  {
    match: /massage|tissue|spa|wellness/i,
    media: {
      category: 'wellness',
      categoryLabel: 'Wellness',
      imageUrl:
        'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=80',
      imageAlt: 'Massage therapy room with soft linens',
      blurb: 'Therapeutic bodywork focused on lasting relief.',
    },
  },
  {
    match: /consult|strategy|architect|product/i,
    media: {
      category: 'consulting',
      categoryLabel: 'Consulting',
      imageUrl:
        'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1200&q=80',
      imageAlt: 'Two people collaborating at a desk',
      blurb: 'Focused 1:1 sessions for product and systems decisions.',
    },
  },
];

const FALLBACK: ServiceMedia = {
  category: 'beauty',
  categoryLabel: 'Services',
  imageUrl:
    'https://images.unsplash.com/photo-1521590832167-7bcbfaaae1e0?auto=format&fit=crop&w=1200&q=80',
  imageAlt: 'Warm studio interior',
  blurb: 'Book a timed session with a SlotBook specialist.',
};

export function mediaForService(name: string): ServiceMedia {
  for (const entry of MEDIA_BY_KEYWORD) {
    if (entry.match.test(name)) return entry.media;
  }
  return FALLBACK;
}

export const HERO_IMAGE =
  'https://images.unsplash.com/photo-1633681926022-84c123f36199?auto=format&fit=crop&w=1800&q=80';

export const ABOUT_IMAGE =
  'https://images.unsplash.com/photo-1600948836101-f9ffda59d250?auto=format&fit=crop&w=1400&q=80';

export const STUDIOS = [
  {
    slug: 'thamel',
    name: 'Thamel Studio',
    city: 'Kathmandu',
    address: 'Jyatha Road, Thamel',
    hours: 'Tue–Sun · 10:00–19:00',
    imageUrl:
      'https://images.unsplash.com/photo-1521590832167-7bcbfaaae1e0?auto=format&fit=crop&w=1000&q=80',
    rating: 4.9,
    reviewCount: 212,
    description:
      'Our flagship location — four treatment rooms, a dedicated styling bar, and a quiet lounge for the wait between sessions.',
    amenities: ['Free WiFi', 'Wheelchair access', 'Private parking', 'Complimentary tea bar'],
  },
  {
    slug: 'patan',
    name: 'Patan Loft',
    city: 'Lalitpur',
    address: 'Pulchowk Crossing',
    hours: 'Mon–Sat · 09:00–18:00',
    imageUrl:
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1000&q=80',
    rating: 4.8,
    reviewCount: 156,
    description:
      'A converted loft above Pulchowk Crossing with skylight-lit rooms — favored for longer wellness and consulting sessions.',
    amenities: ['Free WiFi', 'Elevator access', 'Bike parking', 'Filtered water'],
  },
  {
    slug: 'boudha',
    name: 'Boudha Wellness Room',
    city: 'Kathmandu',
    address: 'Near Boudhanath Stupa',
    hours: 'Daily · 08:00–20:00',
    imageUrl:
      'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1000&q=80',
    rating: 5.0,
    reviewCount: 98,
    description:
      'Open every day of the week, steps from Boudhanath Stupa — our quietest room, built for deep-tissue and recovery work.',
    amenities: ['Free WiFi', 'Heated floors', 'Locker room', 'Herbal tea bar'],
  },
] as const;

export const PROVIDERS = [
  {
    slug: 'mira',
    name: 'Mira Shrestha',
    role: 'Senior Stylist',
    focus: 'Cuts & finishing',
    imageUrl:
      'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?auto=format&fit=crop&w=800&q=80',
    rating: 4.9,
    reviewCount: 184,
    yearsExperience: 11,
    bio: 'Mira trained in Delhi and London before opening the Thamel styling bar. She specializes in precision cuts and low-maintenance color that grows out cleanly.',
    specialties: ['Precision cuts', 'Balayage', 'Bridal styling'],
    studioSlug: 'thamel',
  },
  {
    slug: 'arjun',
    name: 'Arjun Thapa',
    role: 'Licensed Therapist',
    focus: 'Deep tissue & recovery',
    imageUrl:
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=800&q=80',
    rating: 4.9,
    reviewCount: 231,
    yearsExperience: 9,
    bio: 'A certified sports-massage therapist who spent six years working with regional athletics teams before joining SlotBook full-time.',
    specialties: ['Deep tissue', 'Sports recovery', 'Trigger-point therapy'],
    studioSlug: 'boudha',
  },
  {
    slug: 'sita',
    name: 'Sita Gurung',
    role: 'Strategy Partner',
    focus: 'Product & architecture',
    imageUrl:
      'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=800&q=80',
    rating: 5.0,
    reviewCount: 67,
    yearsExperience: 14,
    bio: 'Former engineering lead turned independent consultant, Sita advises early-stage teams on system design and product strategy.',
    specialties: ['Systems design', 'Product strategy', 'Technical due diligence'],
    studioSlug: 'patan',
  },
] as const;

export const TESTIMONIALS = [
  {
    quote:
      'I have tried three other booking apps for my salon visits and this is the first one where the slot I picked was actually still open when I showed up.',
    author: 'Priya N.',
    context: 'Booked a cut with Mira · Thamel Studio',
  },
  {
    quote:
      'The confirmation email had everything — address, parking notes, what to bring. Zero back-and-forth with the front desk.',
    author: 'Rohan K.',
    context: 'Booked recovery massage · Boudha Wellness Room',
  },
  {
    quote:
      'We use SlotBook for every strategy session now. Rescheduling takes ten seconds and nothing ever double-books.',
    author: 'Dana W.',
    context: 'Booked with Sita · Patan Loft',
  },
] as const;

export const TRUST_STATS = [
  { value: '18,400+', label: 'Appointments kept on time' },
  { value: '4.9 / 5', label: 'Average studio rating' },
  { value: '3', label: 'Studios across the valley' },
  { value: '< 1s', label: 'Slot availability lag' },
] as const;

export const CATEGORIES: Array<{
  slug: ServiceCategory;
  title: string;
  description: string;
  imageUrl: string;
}> = [
  {
    slug: 'beauty',
    title: 'Beauty',
    description: 'Salon appointments with senior stylists.',
    imageUrl:
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1000&q=80',
  },
  {
    slug: 'wellness',
    title: 'Wellness',
    description: 'Massage and recovery sessions.',
    imageUrl:
      'https://images.unsplash.com/photo-1519823551278-3af0709777ff?auto=format&fit=crop&w=1000&q=80',
  },
  {
    slug: 'consulting',
    title: 'Consulting',
    description: 'Focused strategy and systems sessions.',
    imageUrl:
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1000&q=80',
  },
];
