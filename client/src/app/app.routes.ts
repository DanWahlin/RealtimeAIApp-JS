import { Routes } from '@angular/router';
import { LanguageCoachComponent } from './language-coach/language-coach.component';
import { MedicalCoachComponent } from './medical-coach/medical-coach.component';

export const routes: Routes = [
    { path: '', redirectTo: '/language-coach', pathMatch: 'full' },
    { path: 'language-coach', component: LanguageCoachComponent },
    { path: 'medical-coach', component: MedicalCoachComponent },
    { path: '**', redirectTo: '/language-coach', pathMatch: 'full' }
];
