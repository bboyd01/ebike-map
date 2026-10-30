import { render } from 'preact';
import { installLoginRedirect } from './auth';
import { App } from './ui/App';
import './style.css';

installLoginRedirect();
render(<App />, document.getElementById('app')!);
