import { getSession } from '@/lib/auth'
import { homeRouteFor } from '@/lib/home-route'
import { SplashScreen } from './SplashScreen'

/**
 * Platform entry.
 *
 * This route was `redirect('/dashboard')` and nothing else, so no role ever saw
 * a branded moment on the way in.
 *
 * The destination is decided here, on the server, from the session. The client
 * component below only holds the screen and then follows, so nothing about who
 * may go where is ever settled in the browser. A signed-out visitor is sent to
 * sign in, exactly as before.
 */
export default async function Home() {
  const session = await getSession()
  const destination = homeRouteFor(session?.user?.role)

  return <SplashScreen destination={destination} />
}
