// SPDX-License-Identifier: AGPL-3.0-only
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AboutPage } from '@/pages/AboutPage';
import { BookingDetailPage } from '@/pages/BookingDetailPage';
import { CategoryPage } from '@/pages/CategoryPage';
import { ConfirmationPage } from '@/pages/ConfirmationPage';
import { FaqPage } from '@/pages/FaqPage';
import { HomePage } from '@/pages/HomePage';
import { HowItWorksPage } from '@/pages/HowItWorksPage';
import { MyBookingsPage } from '@/pages/MyBookingsPage';
import { OpsPage } from '@/pages/OpsPage';
import { ProviderDetailPage } from '@/pages/ProviderDetailPage';
import { ProvidersPage } from '@/pages/ProvidersPage';
import { ServiceDetailPage } from '@/pages/ServiceDetailPage';
import { ServicesPage } from '@/pages/ServicesPage';
import { StudioDetailPage } from '@/pages/StudioDetailPage';
import { StudiosPage } from '@/pages/StudiosPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="services/:id" element={<ServiceDetailPage />} />
          <Route path="categories/:slug" element={<CategoryPage />} />
          <Route path="studios" element={<StudiosPage />} />
          <Route path="studios/:slug" element={<StudioDetailPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="providers/:slug" element={<ProviderDetailPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="faq" element={<FaqPage />} />
          <Route path="confirmation" element={<ConfirmationPage />} />
          <Route path="my-bookings" element={<MyBookingsPage />} />
          <Route path="bookings/:id" element={<BookingDetailPage />} />
          <Route path="ops" element={<OpsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
