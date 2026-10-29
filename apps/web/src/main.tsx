import { render } from 'preact';
import { RouteDebug } from './debug/RouteDebug';
import './style.css';

render(<RouteDebug />, document.getElementById('app')!);
